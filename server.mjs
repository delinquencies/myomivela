// myo. care portal server: start-up checks, then one HTTP server for the API and the static site.
// The pieces live in lib/: config, db (migrations, transactions), auth, scheduling, bookings, photos,
// api (route table) with handlers in lib/routes/, and static (headers and files).
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, productionProblems } from './lib/config.mjs';

const problems = productionProblems();
if (problems.length) { console.error('Refusing to start in production:\n- ' + problems.join('\n- ')); process.exit(1); }

// Imported after the production check so a misconfigured server exits before touching the database.
const { requireThat } = await import('./lib/validate.mjs');
const { ensureAdmin } = await import('./lib/auth.mjs');
const { handleApi } = await import('./lib/api.mjs');
const { securityHeaders, serveStatic } = await import('./lib/static.mjs');
await ensureAdmin();

const root = dirname(fileURLToPath(import.meta.url));
const server = createServer(async (request,response) => {
  securityHeaders(response);
  try {
    let path;
    try { path = decodeURIComponent(new URL(request.url,'http://localhost').pathname); } catch { requireThat(false,'Page not found.',404); }
    if (!path.startsWith('/api/')) return await serveStatic(request,response,path,root);
    response.setHeader('Cache-Control','private, no-store');
    const data = await handleApi(request,response,path);
    if (!response.writableEnded) {
      response.setHeader('Content-Type','application/json; charset=utf-8');
      response.end(JSON.stringify(data));
    }
  } catch (error) {
    if (!error.status) console.error(error);
    if (!response.headersSent) response.writeHead(error.status || 500, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    response.end(JSON.stringify({error:error.status ? error.message : 'The request could not be completed.'}));
  }
});
server.listen(config.port,config.host,() => console.log('myo. listening on port '+server.address().port));
