import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createServer } from './server.mjs';

let server, client, base;
before(async () => {
  server = await createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  client = new Client({ name: 'moyu-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
});
after(async () => {
  await client?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});

const call = (name, args) => client.callTool({ name, arguments: args });

test('MCP client discovers only read-only calendar operations', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), ['count_workdays', 'get_holidays', 'list_regions']);
  assert.ok(tools.every(({ annotations }) => annotations.readOnlyHint));
  const { structuredContent } = await call('list_regions', {});
  assert.ok(structuredContent.regions.some(({ id, weekendDays }) => id === 'SA' && weekendDays.join() === '5,6'));
});

test('serves the same CN make-up workdays and US observed days as the PWA', async () => {
  const cn = await call('get_holidays', { region: 'CN', year: 2027 });
  assert.equal(cn.structuredContent.days.find(({ date }) => date === '2027-01-31').isOffDay, false);
  const us = await call('get_holidays', { region: 'US', year: 2027 });
  assert.equal(us.structuredContent.days.find(({ date }) => date === '2027-12-31').observedFor, '2028-01-01');
  const nsw = await call('get_holidays', { region: 'AU', year: 2027 });
  assert.equal(nsw.structuredContent.days.find(({ date }) => date === '2027-04-26').observedFor, '2027-04-25');
});

test('counts Saudi Sunday as a workday, rejects unknown years and invalid civil dates', async () => {
  const sa = (start, end) => call('count_workdays', { region: 'SA', start, end });
  assert.equal((await sa('2026-09-24', '2026-09-27')).structuredContent.workdays, 2);
  assert.equal((await sa('2040-01-01', '2040-01-07')).isError, true);
  assert.equal((await sa('2026-02-30', '2026-03-01')).isError, true);
  assert.equal((await sa('2026-01-02', '2026-01-01')).isError, true);
  assert.equal((await call('get_holidays', { region: 'AU', year: 2099 })).isError, true);
});

test('health is accessible; untrusted origins, wrong methods and oversized requests are rejected', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { Origin: 'https://example.test' } })).status, 403);
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(32769) })).status, 413);
});
