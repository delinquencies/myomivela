// Which files are public, and their content types. Shared by the Node static server and the Worker build.
export const types = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.ttf':'font/ttf','.xml':'application/xml','.txt':'text/plain' };
export const publicMyoPages = new Set([
  '/myo/launch/',
  '/myo/launch/index.html',
  '/myo/about/',
  '/myo/about/index.html',
  '/myo/safety_first_faq/',
  '/myo/safety_first_faq/index.html',
  '/myo/client_journal_cute_lively/',
  '/myo/client_journal_cute_lively/index.html',
]);
const extension = path => path.match(/\.[^./]+$/)?.[0] || '';
// `path` is a decoded URL path such as /assets/home.css. Directory paths ending in / mean their index.html.
export function isPublicPath(path) {
  if (path === '/' || publicMyoPages.has(path)) return true;
  if (path.split('/').includes('..')) return false;
  return /^\/(?:index\.html|robots\.txt|sitemap\.xml|(?:assets|portal)\/[\w./ -]*)$/.test(path) && (path.endsWith('/') || extension(path) in types);
}
