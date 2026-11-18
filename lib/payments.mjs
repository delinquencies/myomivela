// Online payment providers (C3.1). The app only ever sends customers to a hosted checkout page and learns about
// money from the provider's signed webhooks; a browser returning from checkout proves nothing. Card details never
// reach this app. Two providers: Stripe Checkout, and a fake with the same webhook format for tests.
import { config } from './config.mjs';
import { requireThat } from './validate.mjs';

const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}
// Constant-time comparison of two hex strings.
const sameHex = (a, b) => a.length === b.length && [...a].reduce((diff, char, index) => diff | (char.charCodeAt(0) ^ b.charCodeAt(index)), 0) === 0;

// Stripe's signature scheme: header "t=<seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>", within 5 minutes.
export async function signPayload(secret, body, seconds = Math.floor(Date.now() / 1000)) {
  return 't=' + seconds + ',v1=' + await hmacHex(secret, seconds + '.' + body);
}
export async function verifyWebhook(body, header, now = Date.now()) {
  requireThat(config.stripeWebhookSecret, 'Payments are not set up.', 503, 'payments_unavailable');
  const parts = (header || '').split(',').map(part => [part.slice(0, part.indexOf('=')).trim(), part.slice(part.indexOf('=') + 1).trim()]);
  const timestamp = Number(parts.find(([name]) => name === 't')?.[1]);
  const signatures = parts.filter(([name]) => name === 'v1').map(([, value]) => value);
  requireThat(Number.isSafeInteger(timestamp) && Math.abs(now / 1000 - timestamp) <= 300 && signatures.length, 'Invalid signature.', 400, 'invalid_signature');
  const expected = await hmacHex(config.stripeWebhookSecret, timestamp + '.' + body);
  requireThat(signatures.some(signature => sameHex(signature, expected)), 'Invalid signature.', 400, 'invalid_signature');
  let event;
  try { event = JSON.parse(body); } catch { requireThat(false, 'Invalid event.'); }
  requireThat(typeof event?.id === 'string' && typeof event.type === 'string' && event.data?.object, 'Invalid event.');
  return event;
}

// Stripe's API takes form-encoded nested fields: { a:{ b:1 } } → a[b]=1.
function form(values, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(values)) {
    const name = prefix ? prefix + '[' + key + ']' : key;
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') form(value, name, out); else out.append(name, String(value));
  }
  return out;
}
async function stripe(path, values, idempotencyKey) {
  const response = await fetch('https://api.stripe.com/v1/' + path, { method:'POST', body:form(values), headers:{
    Authorization:'Bearer ' + config.stripeSecretKey, 'Content-Type':'application/x-www-form-urlencoded',
    ...(idempotencyKey ? { 'Idempotency-Key':idempotencyKey } : {}),
  } });
  const result = await response.json().catch(() => ({}));
  requireThat(response.ok, 'The payment provider refused the request. Try again later.', 502, 'payment_provider_error');
  return result;
}
const stripeProvider = {
  name:'stripe',
  async createCheckout({ amount, description, reference, metadata, email, successUrl, cancelUrl, idempotencyKey }) {
    const expires = Math.floor(Date.now() / 1000) + 30 * 60; // Stripe's shortest allowed lifetime
    const session = await stripe('checkout/sessions', {
      mode:'payment', client_reference_id:reference, customer_email:email, success_url:successUrl, cancel_url:cancelUrl,
      expires_at:expires, metadata, payment_intent_data:{ metadata },
      line_items:{ 0:{ quantity:1, price_data:{ currency:'usd', unit_amount:amount, product_data:{ name:description } } } },
    }, idempotencyKey);
    return { id:session.id, url:session.url, expires:expires * 1000 };
  },
  async refund({ paymentRef, amount, metadata, idempotencyKey }) {
    const refund = await stripe('refunds', { payment_intent:paymentRef, amount, metadata }, idempotencyKey);
    return { id:refund.id, status:refund.status };
  },
};
// The fake behaves like Stripe without the network: sessions and refunds succeed, and tests deliver the webhook.
let fakeCount = 0;
const fakeId = prefix => prefix + '_fake_' + Date.now().toString(36) + (++fakeCount).toString(36);
const fakeProvider = {
  name:'fake',
  async createCheckout({ successUrl }) {
    const id = fakeId('cs');
    return { id, url:successUrl.replace('payment=success', 'payment=success&fake_session=' + id), expires:Date.now() + 30 * 60_000 };
  },
  async refund() { return { id:fakeId('re'), status:'succeeded' }; },
};

// The configured provider, or null when online payment is off.
export function provider() {
  if (config.payments === 'stripe' && config.stripeSecretKey && config.stripeWebhookSecret) return stripeProvider;
  if (config.payments === 'fake' && config.stripeWebhookSecret) return fakeProvider;
  return null;
}
export const requireProvider = () => {
  const found = provider();
  requireThat(found, 'Online payment isn’t available. Myomi can take payment another way.', 503, 'payments_unavailable');
  return found;
};
