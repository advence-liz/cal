import { readFile, readdir } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { DEFAULT_REGION, REGIONS } from '../holidays.js';
import { countWorkdays } from '../workday.js';

const ROOT = new URL('../', import.meta.url);
const MAX_BODY = 32 * 1024;
const MAX_IN_FLIGHT = 32;
const REGION = z.enum(Object.keys(REGIONS));
const YEAR = z.number().int().min(1900).max(2100);
const DATE = z.iso.date().refine(value => YEAR.safeParse(Number(value.slice(0, 4))).success, 'Supported years: 1900–2100');
const hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const format = data => ({ structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] });
const failure = (message, missingYears = []) => ({ ...format({ message, missingYears }), isError: true });

async function snapshots() {
  const read = async file => JSON.parse(await readFile(new URL(file, ROOT), 'utf8'));
  const dataFiles = await readdir(new URL('data/', ROOT));
  const data = new Map();
  for (const [region, info] of Object.entries(REGIONS)) {
    if (region === DEFAULT_REGION) {
      const years = dataFiles.filter(file => /^holidays-\d{4}\.json$/.test(file)).map(file => Number(file.slice(9, 13))).sort();
      data.set(region, new Map(await Promise.all(years.map(async year => {
        const { days } = await read(`data/holidays-${year}.json`);
        if (!days.length) throw new Error(`Empty CN snapshot for ${year}`);
        return [year, new Map(days.map(({ date, name, isOffDay }) => [date, { name, isOffDay }]))];
      }))));
    } else {
      const { years } = await read(info.file);
      data.set(region, new Map(Object.entries(years).map(([year, days]) => {
        if (!days.length) throw new Error(`Empty ${region} snapshot for ${year}`);
        return [Number(year), new Map(days.map(([date, name, observedFor]) => [date, {
          name, isOffDay: true, ...(observedFor ? { observedFor } : {}),
        }]))];
      })));
    }
    if (!data.get(region).size) throw new Error(`No snapshots for ${region}`);
  }
  return data;
}

function tools(data) {
  const mcp = new McpServer({ name: 'moyu-calendar', version: '1.0.0' });
  mcp.registerTool('list_regions', {
    description: 'List holiday regions, their scope, weekend weekdays (0=Sunday) and verified snapshot years.',
    inputSchema: z.object({}).strict(), annotations: hints,
  }, () => format({ regions: Object.entries(REGIONS).map(([id, info]) => ({
    id, source: info.source, scope: info.scope, weekendDays: info.weekendDays ?? [0, 6],
    years: [...data.get(id).keys()].sort((a, b) => a - b),
  })) }));

  mcp.registerTool('get_holidays', {
    description: 'Get public holidays and make-up workdays for a region and a verified year. Missing years return an error, not an empty holiday list.',
    inputSchema: z.object({ region: REGION, year: YEAR }).strict(), annotations: hints,
  }, ({ region, year }) => {
    const rows = data.get(region).get(year);
    if (!rows) return failure(`No verified holiday snapshot for ${region} in ${year}.`, [year]);
    const { scope, source } = REGIONS[region];
    return format({ region, year, scope, source, days: [...rows.entries()]
      .sort(([a], [b]) => a.localeCompare(b)).map(([date, entry]) => ({ date, ...entry })) });
  });

  mcp.registerTool('count_workdays', {
    description: 'Count workdays in the inclusive YYYY-MM-DD range, honoring the regional weekend, holidays and make-up workdays. All years in the range must be verified.',
    inputSchema: z.object({ region: REGION, start: DATE, end: DATE }).strict(), annotations: hints,
  }, ({ region, start, end }) => {
    if (start > end) return failure('start must be on or before end.');
    const store = data.get(region);
    const missing = [];
    for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
      if (!store.has(year)) missing.push(year);
    }
    if (missing.length) return failure(`Missing verified holiday data for ${region}.`, missing);
    return format({ region, start, end, workdays: countWorkdays(start, end, store, REGIONS[region].weekendDays) });
  });
  return mcp;
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
