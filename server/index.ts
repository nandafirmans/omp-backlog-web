import { once } from 'node:events';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { createApi } from './api';
import { createRuntime } from './runtime';
import { closeStore, createStore, within } from './store';
import { requestOrigin, parseRemoteOrigin } from './access';

const appRoot = resolve(import.meta.dir, '..');
const remoteOrigin = parseRemoteOrigin(process.env.OMP_BACKLOG_ORIGIN);
const store = createStore();
if (within(appRoot, store.dataDir) || within(store.dataDir, appRoot)) throw new Error('Private application data must be outside the application source tree');
const runtime = await createRuntime(store);
const api = createApi(store, runtime, remoteOrigin);
const port = Number(process.env.OMP_BACKLOG_PORT || 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('OMP_BACKLOG_PORT must be an unprivileged TCP port');
const server = await createServer({
  root: appRoot,
  server: {
    host: '127.0.0.1', port, strictPort: true, cors: false,
    allowedHosts: ['127.0.0.1', 'localhost', ...(remoteOrigin ? [new URL(remoteOrigin).hostname] : [])],
    fs: { strict: true, allow: [appRoot], deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', `${store.dataDir}/**`, '**/.omp-backlog/**'] },
  },
  plugins: [{
    name: 'private-local-api',
    configureServer(app) {
      app.middlewares.use((request, response, next) => {
        const host = request.headers.host || '';
        const origin = requestOrigin(host, remoteOrigin);
        if (!origin) { response.writeHead(403, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Invalid Host' })); return; }
        if (!request.url?.startsWith('/api/') && request.url !== '/api') { next(); return; }
        const abort = new AbortController();
        response.once('close', () => abort.abort());
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) { if (Array.isArray(value)) for (const entry of value) headers.append(key, entry); else if (value !== undefined) headers.set(key, value); }
        const method = request.method || 'GET';
        // Bridge Node's byte iterator into the DOM stream expected by Bun Request.
        const iterator = request[Symbol.asyncIterator]();
        const body = method === 'GET' || method === 'HEAD' ? undefined : new ReadableStream<Uint8Array>({
          async pull(controller) {
            const chunk = await iterator.next();
            if (chunk.done) { controller.close(); return; }
            if (!Buffer.isBuffer(chunk.value)) throw new Error('Expected request bytes');
            controller.enqueue(chunk.value);
          },
          async cancel() { await iterator.return?.(); },
        });
        const webRequest = new Request(`${origin}${request.url}`, { method, headers, body, signal: abort.signal });
        void (async () => {
          const result = await api(webRequest);
          response.writeHead(result.status, Object.fromEntries(result.headers));
          if (!result.body || method === 'HEAD') { response.end(); return; }
          const reader = result.body.getReader();
          try { while (!abort.signal.aborted) { const { done, value } = await reader.read(); if (done) break; if (!response.write(value)) await once(response, 'drain', { signal: abort.signal }); } }
          finally { await reader.cancel().catch(() => {}); if (!response.writableEnded) response.end(); }
        })().catch(() => { if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' }); if (!response.writableEnded) response.end(JSON.stringify({ error: 'Request failed' })); });
      });
    },
  }],
});
await server.listen();
server.printUrls();
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await runtime.close();
  await server.close();
  closeStore(store);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
