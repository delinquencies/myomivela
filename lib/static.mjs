// Node only: serves the allow-listed public files from the repository root.
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { requireThat } from './validate.mjs';
import { types, isPublicPath } from './site.mjs';

export async function serveStatic(request, path, root) {
  requireThat(['GET','HEAD'].includes(request.method), 'Method not allowed.',405);
  requireThat(isPublicPath(path), 'Page not found.',404);
  const file = resolve(root,'.'+path+(path.endsWith('/') ? 'index.html' : ''));
  requireThat(['assets','myo','portal'].some(dir => file.startsWith(resolve(root,dir)+sep)) ||
    ['index.html','robots.txt','sitemap.xml'].some(name => file === resolve(root,name)), 'Page not found.',404);
  const mime = types[extname(file)];
  requireThat(mime,'Page not found.',404);
  let content;
  try { content = await readFile(file); } catch { requireThat(false,'Page not found.',404); }
  return new Response(request.method === 'HEAD' ? null : content, { headers:{ 'Content-Type':mime } });
}
