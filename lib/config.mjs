// Every setting the app reads. Node reads them from process.env; the Worker passes its env bindings.
export const config = {};
export function configure(env) {
  Object.assign(config, {
    production: env.NODE_ENV === 'production',
    origin: env.MYO_ORIGIN || '',                    // public origin for the write check; defaults to the request's own
    secureCookies: env.MYO_SECURE_COOKIES === '1',   // Secure cookies and HSTS even when the request URL is http (TLS proxy)
    trustProxy: env.MYO_TRUST_PROXY || '',           // Node only: '1' = last X-Forwarded-For entry, 'cloudflare' = CF-Connecting-IP
    adminEmail: env.MYO_ADMIN_EMAIL || '',
    adminPassword: env.MYO_ADMIN_PASSWORD || '',
    pricingMode: env.MYO_PRICING_MODE === 'catalog' ? 'catalog' : 'launch',
    // Overrides how many minutes before its booked time a visit may start. Unset: the visit buffer is used.
    earlyStartMinutes: /^\d+$/.test(env.MYO_EARLY_START_MINUTES || '') ? Number(env.MYO_EARLY_START_MINUTES) : null,
    // Home-access vault (C2.3): base64 of 32 random bytes. The previous key is still accepted for reading, so a key
    // can be rotated by moving the old value to MYO_VAULT_KEY_PREVIOUS; records are re-encrypted as they are read.
    vaultKey: env.MYO_VAULT_KEY || '',
    vaultKeyPrevious: env.MYO_VAULT_KEY_PREVIOUS || '',
    // Online payment (C3.1): 'stripe' (hosted Stripe Checkout), 'fake' (tests only) or '' (off: staff record
    // payments by hand). The webhook secret verifies the provider's events, which are the only proof of payment.
    payments: ['stripe','fake'].includes(env.MYO_PAYMENTS) ? env.MYO_PAYMENTS : '',
    stripeSecretKey: env.MYO_STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: env.MYO_STRIPE_WEBHOOK_SECRET || '',
    // Email (C3.6): '' keeps messages waiting in the outbox (staff can see them); 'log' marks them sent without
    // sending (tests). A real provider is added as one more driver in lib/outbox.mjs once one is chosen.
    email: ['log'].includes(env.MYO_EMAIL) ? env.MYO_EMAIL : '',
    // Scheduled backups: on Node, the directory to write them to (unset: off); on Cloudflare, the BACKUPS bucket.
    backupDir: env.MYO_BACKUP_DIR || '',
    // Set only by the test harness: lets a Worker run with the test-only MYO_PAYMENTS=fake and MYO_EMAIL=log.
    testSettings: env.MYO_TEST_SETTINGS === '1',
    backupKeep: /^\d+$/.test(env.MYO_BACKUP_KEEP || '') && Number(env.MYO_BACKUP_KEEP) > 0 ? Number(env.MYO_BACKUP_KEEP) : 30,
  });
  return config;
}
configure(globalThis.process?.env || {});

// Node in production must be explicit about HTTPS, because it usually sits behind a TLS proxy and sees http URLs.
// (A Worker always sees the real https URL, so it needs neither setting.)
export function productionProblems() {
  if (!config.production) return [];
  const problems = [];
  if (!/^https:\/\/[^/]+$/.test(config.origin)) problems.push('MYO_ORIGIN must be the public https origin, for example https://example.com');
  if (!config.secureCookies) problems.push('MYO_SECURE_COOKIES must be 1');
  return [...problems, ...settingProblems()];
}
// A Worker is always a deployment (tests run it too, with MYO_TEST_SETTINGS=1), so it checks the settings that are
// wrong anywhere real money and real clients are involved. It refuses the API while any remain (worker.mjs).
export const workerProblems = () => config.testSettings ? [] : settingProblems();
function settingProblems() {
  const problems = [];
  if (!config.vaultKey) problems.push('MYO_VAULT_KEY must be set (base64 of 32 random bytes) to protect home-access details');
  if (config.payments === 'fake') problems.push('MYO_PAYMENTS=fake is for tests only');
  if (config.email === 'log') problems.push('MYO_EMAIL=log is for tests only (it sends nothing)');
  if (config.payments === 'stripe' && !(config.stripeSecretKey && config.stripeWebhookSecret))
    problems.push('MYO_PAYMENTS=stripe needs MYO_STRIPE_SECRET_KEY and MYO_STRIPE_WEBHOOK_SECRET');
  return problems;
}
// True when cookies should carry Secure and responses should send HSTS.
export const isSecure = url => config.secureCookies || url.protocol === 'https:';
