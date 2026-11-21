import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const cacheControl = 'no-cache';
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml' };
const allow = /^(?:index\.html|styles\.css|sw\.js|favicon\.svg|src\/[a-z-]+\.js)$/;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; worker-src 'self'; connect-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'";

export async function serve(port = 0, prefix = '/') {
  const server = createServer(async (request, response) => {
    const headers = {
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cache-Control': cacheControl,
      'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };
    const send = (code, payload, more = {}) => {
      response.writeHead(code, { ...headers, ...more });
      response.end(request.method === 'HEAD' ? undefined : payload);
    };
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'Method not allowed', { Allow: 'GET, HEAD' });
      if (!path.startsWith(prefix)) return send(404, 'Not found');
      const relative = path.slice(prefix.length) || 'index.html';
      if (!allow.test(relative)) return send(404, 'Not found');
      const type = types[relative.split('.').at(-1)];
      send(200, await readFile(new URL(relative, root)), {
        'Content-Type': `${type}; charset=utf-8`,
        ...(relative === 'index.html' ? { 'Content-Security-Policy': CSP } : {}),
      });
    } catch { send(404, 'Not found'); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}${prefix}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { origin } = await serve(Number(process.env.PORT ?? 4173));
  console.log(`CareBridge running at ${origin}`);
}
