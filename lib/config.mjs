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
    // Overrides how many minutes before its booked time a visit may start. Unset: the visit buffer is used.
    earlyStartMinutes: /^\d+$/.test(env.MYO_EARLY_START_MINUTES || '') ? Number(env.MYO_EARLY_START_MINUTES) : null,
    // Home-access vault (C2.3): base64 of 32 random bytes. The previous key is still accepted for reading, so a key
    // can be rotated by moving the old value to MYO_VAULT_KEY_PREVIOUS; records are re-encrypted as they are read.
    vaultKey: env.MYO_VAULT_KEY || '',
    vaultKeyPrevious: env.MYO_VAULT_KEY_PREVIOUS || '',
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
  if (!config.vaultKey) problems.push('MYO_VAULT_KEY must be set (base64 of 32 random bytes) to protect home-access details');
  return problems;
}
// True when cookies should carry Secure and responses should send HSTS.
export const isSecure = url => config.secureCookies || url.protocol === 'https:';
