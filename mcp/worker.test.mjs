import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createServer } from './server.mjs';
import { once } from 'node:events';

const endpoint = process.env.WORKER_MCP_URL;

async function connect(url) {
  const client = new Client({ name: 'worker-parity', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

if (!endpoint) throw new Error('Set WORKER_MCP_URL to a running Worker MCP endpoint.');

test('Worker and Render adapter agree on verified snapshots and the widest covered span', async () => {
  const server = await createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let worker, reference;
  try {
    worker = await connect(endpoint);
    reference = await connect(`http://127.0.0.1:${server.address().port}/mcp`);
    const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
    const regions = (await call(worker, 'list_regions')).structuredContent.regions;
    assert.deepEqual(regions, (await call(reference, 'list_regions')).structuredContent.regions);
    let longest;
    for (const { id, years } of regions) {
      for (let i = 0; i < years.length;) {
        const first = years[i++];
        while (i < years.length && years[i] === years[i - 1] + 1) i++;
        const last = years[i - 1];
        const args = { region: id, start: `${first}-01-01`, end: `${last}-12-31` };
        const days = (Date.parse(args.end) - Date.parse(args.start)) / 86400000 + 1;
        if (!longest || days > longest.days) longest = { args, days };
      }
    }
    assert.ok(longest);
    const count = await call(worker, 'count_workdays', longest.args);
    assert.equal(count.isError ?? false, false);
    assert.deepEqual(count.structuredContent, (await call(reference, 'count_workdays', longest.args)).structuredContent);
    console.log('Longest verified interval:', JSON.stringify({ ...count.structuredContent, days: longest.days }));

    const sa = await call(worker, 'count_workdays', { region: 'SA', start: '2026-09-24', end: '2026-09-27' });
    assert.equal(sa.structuredContent.workdays, 2);
    let verified = 0;
    for (const { id: region, years } of regions) {
      for (const year of years) {
        const args = { region, year };
        const live = await call(worker, 'get_holidays', args);
        const expected = await call(reference, 'get_holidays', args);
        assert.equal(live.isError ?? false, false, `Worker rejected ${region} ${year}`);
        assert.equal(expected.isError ?? false, false, `Reference rejected ${region} ${year}`);
        assert.deepEqual(live.structuredContent, expected.structuredContent, `${region} ${year} snapshot differs`);
        verified++;
      }
    }
    console.log(`Verified holiday snapshot payloads: ${verified}`);
    const missing = await call(worker, 'count_workdays', { region: 'AU', start: '2027-12-31', end: '2028-01-03' });
    assert.equal(missing.isError, true);
    assert.deepEqual(missing.structuredContent.missingYears, [2028]);
  } finally {
    await worker?.close();
    await reference?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
