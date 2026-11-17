// Security headers and the allow-listed static site.
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { config } from './config.mjs';
import { requireThat } from './validate.mjs';

const types = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.ttf':'font/ttf','.xml':'application/xml','.txt':'text/plain' };
const publicMyoPages = new Set([
  '/myo/safety_first_faq/',
  '/myo/safety_first_faq/index.html',
  '/myo/client_journal_cute_lively/',
  '/myo/client_journal_cute_lively/index.html',
]);
// Scripts and styles are same-origin only; the font host mirrors the fallback URLs in assets/home.css.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' https://raw.githubusercontent.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Referrer-Policy','same-origin');
  response.setHeader('X-Frame-Options','DENY');
  response.setHeader('Content-Security-Policy',contentSecurityPolicy);
  response.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=(), payment=()');
  if (config.secureCookies) response.setHeader('Strict-Transport-Security','max-age=31536000');
}

// Serves only the public pages and the assets, myo and portal directories under `root`.
export async function serveStatic(request, response, path, root) {
  requireThat(['GET','HEAD'].includes(request.method), 'Method not allowed.',405);
  requireThat(path === '/' || publicMyoPages.has(path) ||
    /^\/(?:index\.html|robots\.txt|sitemap\.xml|(?:assets|portal)\/[\w./ -]*)$/.test(path), 'Page not found.',404);
  const file = resolve(root,'.'+path+(path.endsWith('/') ? 'index.html' : ''));
  requireThat(['assets','myo','portal'].some(dir => file.startsWith(resolve(root,dir)+sep)) ||
    ['index.html','robots.txt','sitemap.xml'].some(name => file === resolve(root,name)), 'Page not found.',404);
  const mime = types[extname(file)];
  requireThat(mime,'Page not found.',404);
  let content;
  try { content = await readFile(file); } catch { requireThat(false,'Page not found.',404); }
  response.setHeader('Content-Type',mime);
  response.end(request.method === 'HEAD' ? undefined : content);
}
