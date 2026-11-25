import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { indexSnapshots, tools, MAX_BODY } from './calendar-tools.mjs';
import files from './worker-snapshots.generated.mjs';

const snapshots = indexSnapshots(files);
const send = (status, value, extra = {}) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', ...extra },
});

export default {
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/health' && req.method === 'GET') return send(200, { status: 'ok' });
    if (path !== '/mcp') return send(404, { error: 'Not found' });
    if (req.headers.has('Origin')) return send(403, { error: 'Origin is not allowed' });
    if (req.method !== 'POST') return send(405, { error: 'POST required' }, { Allow: 'POST' });
    if (req.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return send(415, { error: 'application/json required' });
    }
    if (Number(req.headers.get('Content-Length')) > MAX_BODY) return send(413, { error: 'Request too large' });
    if (!req.body) return send(400, { error: 'Missing JSON' });

    const reader = req.body.getReader();
    const decoder = new TextDecoder();
    let text = '', size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BODY) {
          await reader.cancel();
          return send(413, { error: 'Request too large' });
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch {
      return send(400, { error: 'Failed reading JSON' });
    } finally { reader.releaseLock(); }

    let parsedBody;
    try { parsedBody = JSON.parse(text); }
    catch { return send(400, { error: 'Invalid JSON' }); }
    const mcp = tools(snapshots);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    try {
      await mcp.connect(transport);
      return await transport.handleRequest(req, { parsedBody });
    } catch (error) {
      console.error('MCP request failed:', error.message);
      return send(500, { error: 'MCP request failed' });
    } finally { await mcp.close(); }
  },
};
