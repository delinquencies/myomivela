// Copies the public site (index, robots, sitemap, assets/, portal/, and the public myo/ pages) into dist/site
// for Cloudflare static assets. Only paths allowed by lib/site.mjs are copied, so nothing private is published.
import { readdir, rm, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublicPath } from '../lib/site.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist', 'site');
const sources = ['index.html', 'robots.txt', 'sitemap.xml', 'assets', 'portal', 'myo'];

async function* files(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!entries) { yield path; return; }
  for (const entry of entries) yield* files(join(path, entry.name));
}

await rm(output, { recursive: true, force: true });
let copied = 0;
for (const source of sources) {
  for await (const file of files(join(root, source))) {
    const urlPath = '/' + relative(root, file).split(sep).join('/');
    if (!isPublicPath(urlPath)) continue;
    await mkdir(dirname(join(output, urlPath)), { recursive: true });
    await copyFile(file, join(output, urlPath));
    copied++;
  }
}
console.log('Copied ' + copied + ' public files to ' + relative(root, output));
