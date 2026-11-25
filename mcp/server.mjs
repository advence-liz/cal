import { readFile, readdir } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { indexSnapshots, tools, MAX_BODY, MAX_IN_FLIGHT } from './calendar-tools.mjs';

const ROOT = new URL('../', import.meta.url);

async function snapshots() {
  const files = (await readdir(new URL('data/', ROOT)))
    .filter(file => /^holidays-(?:\d{4}|[a-z]{2})\.json$/.test(file));
  return indexSnapshots(Object.fromEntries(await Promise.all(files.map(async file => {
    const path = `data/${file}`;
    return [path, JSON.parse(await readFile(new URL(path, ROOT), 'utf8'))];
  }))));
}

function send(res, status, data, allow) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(allow ? { Allow: allow } : {}) });
  res.end(JSON.stringify(data));
}

export async function createServer() {
  const data = await snapshots();
  let inFlight = 0;
  return createHttpServer({ headersTimeout: 5_000, requestTimeout: 10_000, connectionsCheckingInterval: 1_000 }, async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') return send(res, 200, { status: 'ok' });
    if (req.url !== '/mcp') return send(res, 404, { error: 'Not found' });
    // Intended for native MCP clients, not cross-origin browser requests.
    if (req.headers.origin) return send(res, 403, { error: 'Origin is not allowed' });
    if (req.method !== 'POST') return send(res, 405, { error: 'POST required' }, 'POST');
    if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return send(res, 415, { error: 'application/json required' });
    }
    if (Number(req.headers['content-length']) > MAX_BODY) return send(res, 413, { error: 'Request too large' });
    if (inFlight >= MAX_IN_FLIGHT) return send(res, 503, { error: 'Server busy' });

    inFlight++;
    let mcp;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > MAX_BODY) {
          res.setHeader('Connection', 'close');
          return send(res, 413, { error: 'Request too large' });
        }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return send(res, 400, { error: 'Invalid JSON' }); }
      mcp = tools(data);
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      console.error('MCP request failed:', error.message);
      if (!res.headersSent) send(res, 500, { error: 'MCP request failed' });
      else if (!res.writableEnded) res.end();
    } finally {
      inFlight--;
      await mcp?.close();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createServer();
  const port = Number(process.env.PORT || 10000);
  server.listen(port, '0.0.0.0', () => console.log(`Moyu Calendar MCP: listening on ${port}`));
}
