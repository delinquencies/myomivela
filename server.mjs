// Local runtime: `npm start` and the test suite. Production runs on Cloudflare through worker.mjs.
// Both use the same app in lib/; this file only bridges node:http to the Fetch-style handlers.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productionProblems } from './lib/config.mjs';

const problems = productionProblems();
if (problems.length) { console.error('Refusing to start in production:\n- ' + problems.join('\n- ')); process.exit(1); }

// Imported after the production check so a misconfigured server exits before touching the database.
const { nodeStore, fileBlobs } = await import('./lib/stores/node.mjs');
const { useStorage } = await import('./lib/db.mjs');
const { ensureAdmin, clientAddress } = await import('./lib/auth.mjs');
const { handleApi } = await import('./lib/api.mjs');
const { withSecurityHeaders, errorResponse, decodedPath } = await import('./lib/headers.mjs');
const { serveStatic } = await import('./lib/static.mjs');

const database = resolve(process.env.MYO_DB || '.myo/data.sqlite');
useStorage(nodeStore(database), fileBlobs(join(dirname(database), 'photos')));
await ensureAdmin();

const root = dirname(fileURLToPath(import.meta.url));
async function handle(request, socketAddress) {
  const url = new URL(request.url);
  try {
    const path = decodedPath(url);
    if (path.startsWith('/api/')) return await handleApi(request, { clientAddress:clientAddress(request, socketAddress) });
    return await serveStatic(request, path, root);
  } catch (error) { return errorResponse(error); }
}

const server = createServer(async (incoming, outgoing) => {
  let response;
  try {
    const hasBody = !['GET','HEAD'].includes(incoming.method);
    const request = new Request('http://' + (incoming.headers.host || 'localhost') + incoming.url, {
      method:incoming.method, headers:incoming.headers,
      body:hasBody ? Readable.toWeb(incoming) : undefined, duplex:hasBody ? 'half' : undefined,
    });
    response = await handle(request, incoming.socket.remoteAddress);
    response = withSecurityHeaders(response, new URL(request.url));
  } catch (error) {
    response = withSecurityHeaders(errorResponse(Object.assign(error, { status:error.status || 400 })), new URL('http://localhost'));
  }
  const headers = {};
  response.headers.forEach((value, name) => { if (name !== 'set-cookie') headers[name] = value; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  outgoing.writeHead(response.status, headers);
  outgoing.end(incoming.method === 'HEAD' || !response.body ? undefined : Buffer.from(await response.arrayBuffer()));
});
server.listen(Number(process.env.PORT || 45838), process.env.HOST || '127.0.0.1', () => console.log('myo. listening on port '+server.address().port));
