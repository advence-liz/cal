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

    const newTools = [
      ['convert_timezone', { datetime: '2026-11-01T01:30-05:00', from_tz: 'America/New_York', to_tz: 'Asia/Kathmandu' }, 'local', '2026-11-01T12:15:00'],
      ['add_workdays', { region: 'FR', start: '2025-01-01', n: 1762 }, 'end', '2031-12-31'],
      ['suggest_leave_plan', { region: 'FR', start: '2026-05-11', end: '2026-05-17', max_leave_days: 1 }, 'plan', {
        start: '2026-05-14', end: '2026-05-17', totalDays: 4, leaveDates: ['2026-05-15'], holidays: [{ date: '2026-05-14', name: '耶稣升天节' }],
      }],
    ];
    for (const [name, args, key, expected] of newTools) {
      const live = await call(worker, name, args);
      const node = await call(reference, name, args);
      assert.equal(live.isError ?? false, false, name);
      assert.deepEqual(live.structuredContent[key], expected, name);
      assert.deepEqual(live.structuredContent, node.structuredContent, name);
    }
    console.log('Verified new MCP tools:', newTools.map(([name]) => name).join(', '));

    const sa = await call(worker, 'count_workdays', { region: 'SA', start: '2026-09-24', end: '2026-09-27' });
    assert.equal(sa.structuredContent.workdays, 2);
    const clock = await call(worker, 'get_local_time', { time_zones: ['UTC', 'Asia/Kathmandu'] });
    assert.equal(clock.isError ?? false, false);
    assert.equal(clock.structuredContent.times[1].offset, '+05:45');
    assert.ok(Math.abs(Date.now() - Date.parse(clock.structuredContent.utc)) < 60_000);
    const meetingArgs = { start: '2026-09-23', end: '2026-09-28', participants: [
      { region: 'SA', time_zone: 'Asia/Riyadh' }, { region: 'SG', time_zone: 'Asia/Singapore' },
    ] };
    const meeting = await call(worker, 'find_meeting_windows', meetingArgs);
    assert.equal(meeting.isError ?? false, false);
    assert.deepEqual(meeting.structuredContent.windows.map(w => w.start_utc), ['2026-09-24T06:00:00Z', '2026-09-28T06:00:00Z']);
    assert.deepEqual(meeting.structuredContent, (await call(reference, 'find_meeting_windows', meetingArgs)).structuredContent);
    console.log('Verified clock and meeting windows in the Worker runtime.');
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
