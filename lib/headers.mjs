// Security headers added to every response, on both runtimes.
import { isSecure } from './config.mjs';

// Scripts and styles are same-origin only; the font host mirrors the fallback URLs in assets/home.css.
export const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' https://raw.githubusercontent.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function withSecurityHeaders(response, url) {
  const secured = new Response(response.body, response); // copy, because fetched responses have immutable headers
  const headers = secured.headers;
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','same-origin');
  headers.set('X-Frame-Options','DENY');
  headers.set('Content-Security-Policy',contentSecurityPolicy);
  headers.set('Permissions-Policy','camera=(self), microphone=(), geolocation=(), payment=()');
  if (isSecure(url)) headers.set('Strict-Transport-Security','max-age=31536000');
  return secured;
}
// A JSON error body with the given status. Unexpected errors (no status) are logged and hidden from the client.
export function errorResponse(error) {
  if (!error.status) console.error(error);
  const body = error.status ? { error:error.message, ...(error.code ? { code:error.code } : {}), ...(error.details || {}) }
    : { error:'The request could not be completed.' };
  return Response.json(body,
    { status:error.status || 500, headers:{ 'Cache-Control':'no-store' } });
}
// Decodes the URL path; malformed percent-encoding is a 404, not a crash.
export function decodedPath(url) {
  try { return decodeURIComponent(url.pathname); }
  catch { throw Object.assign(new Error('Page not found.'), { status:404 }); }
}
