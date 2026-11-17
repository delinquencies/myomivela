// Every environment variable the server reads, in one place.
import { resolve } from 'node:path';

const env = process.env;
export const config = {
  production: env.NODE_ENV === 'production',
  database: resolve(env.MYO_DB || '.myo/data.sqlite'),
  origin: env.MYO_ORIGIN || '',
  secureCookies: env.MYO_SECURE_COOKIES === '1',
  trustProxy: env.MYO_TRUST_PROXY || '', // '1' = last X-Forwarded-For entry, 'cloudflare' = CF-Connecting-IP
  adminEmail: env.MYO_ADMIN_EMAIL || '',
  adminPassword: env.MYO_ADMIN_PASSWORD || '',
  port: Number(env.PORT || 45838),
  host: env.HOST || '127.0.0.1',
};

// Production must be explicit about HTTPS so cookies are Secure and the origin check matches the public URL.
export function productionProblems() {
  if (!config.production) return [];
  const problems = [];
  if (!/^https:\/\/[^/]+$/.test(config.origin)) problems.push('MYO_ORIGIN must be the public https origin, for example https://example.com');
  if (!config.secureCookies) problems.push('MYO_SECURE_COOKIES must be 1');
  return problems;
}
