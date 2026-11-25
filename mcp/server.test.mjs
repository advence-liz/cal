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
  assert.deepEqual(tools.map(({ name }) => name).sort(), [
    'add_workdays', 'convert_timezone', 'count_workdays', 'find_meeting_windows',
    'get_holidays', 'get_local_time', 'list_regions', 'suggest_leave_plan',
  ]);
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

test('converts local times across dates and summer offsets without treating the time zone as a holiday region', async () => {
  const convert = (datetime, from_tz, to_tz) => call('convert_timezone', { datetime, from_tz, to_tz });
  const crossing = await convert('2026-07-15T08:30', 'Asia/Shanghai', 'America/Los_Angeles');
  assert.deepEqual(crossing.structuredContent, {
    from_tz: 'Asia/Shanghai', to_tz: 'America/Los_Angeles', local: '2026-07-14T17:30:00', offset: '-07:00', utc: '2026-07-15T00:30:00Z',
  });
  const winter = await convert('2026-12-15T09:00', 'America/New_York', 'Asia/Kathmandu');
  assert.equal(winter.structuredContent.local, '2026-12-15T19:45:00');
  assert.equal(winter.structuredContent.offset, '+05:45');
  for (const datetime of ['2026-03-08T02:30', '2026-11-01T01:30', '2026-11-01T01:30-06:00', '2026-02-30T12:00']) {
    assert.equal((await convert(datetime, 'America/New_York', 'UTC')).isError, true, datetime);
  }
  const early = await convert('2026-11-01T01:30-04:00', 'America/New_York', 'UTC');
  const late = await convert('2026-11-01T01:30-05:00', 'America/New_York', 'UTC');
  assert.equal(early.structuredContent.utc, '2026-11-01T05:30:00Z');
  assert.equal(late.structuredContent.utc, '2026-11-01T06:30:00Z');
  assert.equal((await convert('2026-07-15T12:00', 'Atlantis/Fake', 'UTC')).isError, true);
});

test('adds or subtracts verified workdays without counting the start day or skipping unpublished years', async () => {
  const add = (region, start, n) => call('add_workdays', { region, start, n });
  assert.deepEqual((await add('CN', '2027-01-30', 1)).structuredContent, {
    region: 'CN', start: '2027-01-30', n: 1, end: '2027-01-31',
  });
  assert.equal((await add('SA', '2026-09-27', -1)).structuredContent.end, '2026-09-24');
  assert.equal((await add('US', '2027-12-30', 1)).structuredContent.end, '2028-01-03');
  assert.equal((await add('FR', '2028-02-28', 1)).structuredContent.end, '2028-02-29');
  assert.equal((await add('AU', '2027-12-31', 0)).structuredContent.end, '2027-12-31');
  assert.deepEqual((await add('AU', '2027-12-31', 1)).structuredContent.missingYears, [2028]);
  assert.deepEqual((await add('FR', '2025-01-01', -1)).structuredContent.missingYears, [2024]);
  assert.equal((await add('AU', '2029-01-01', 0)).isError, true);
  assert.equal((await add('FR', '2026-01-01', 10001)).isError, true);
});

test('local clocks share one current UTC instant and reject unknown zones', async () => {
  const before = Date.now();
  const result = await call('get_local_time', { time_zones: ['UTC', 'Asia/Kathmandu'] });
  const { utc, times } = result.structuredContent;
  assert.ok(Date.parse(utc) >= before && Date.parse(utc) <= Date.now());
  assert.equal(times[0].offset, '+00:00');
  assert.equal(times[1].offset, '+05:45');
  assert.equal(Date.parse(times[1].local + times[1].offset), Date.parse(utc));
  assert.equal((await call('get_local_time', { time_zones: ['Fake/Zone'] })).isError, true);
});

test('finds the longest holiday-linked break within budget and rejects uncovered ranges', async () => {
  const query = (start, end, max_leave_days) => call('suggest_leave_plan', { region: 'FR', start, end, max_leave_days });
  const result = await query('2026-05-11', '2026-05-17', 1);
  assert.deepEqual(result.structuredContent.plan, {
    start: '2026-05-14', end: '2026-05-17', totalDays: 4,
    leaveDates: ['2026-05-15'], holidays: [{ date: '2026-05-14', name: '耶稣升天节' }],
  });
  assert.equal((await query('2026-05-11', '2026-05-17', 0)).structuredContent.plan.totalDays, 1);
  assert.equal((await query('2026-07-18', '2026-07-19', 2)).structuredContent.plan, null);
  assert.deepEqual((await query('2031-12-31', '2032-01-03', 2)).structuredContent.missingYears, [2032]);
  assert.equal((await query('2026-01-01', '2027-01-04', 2)).isError, true);
});

test('finds shared office hours on regional workdays and applies a minimum duration', async () => {
  const request = {
    start: '2026-09-23', end: '2026-09-28',
    participants: [{ region: 'SA', time_zone: 'Asia/Riyadh' }, { region: 'SG', time_zone: 'Asia/Singapore' }],
  };
  const result = await call('find_meeting_windows', request);
  assert.deepEqual(result.structuredContent.windows.map(({ start_utc, end_utc }) => [start_utc, end_utc]), [
    ['2026-09-24T06:00:00Z', '2026-09-24T10:00:00Z'], ['2026-09-28T06:00:00Z', '2026-09-28T10:00:00Z'],
  ]);
  assert.equal(result.structuredContent.windows[0].participants[1].start_local, '2026-09-24T14:00:00');
  assert.deepEqual((await call('find_meeting_windows', { ...request, duration_minutes: 241 })).structuredContent.windows, []);
  assert.equal((await call('find_meeting_windows', { ...request, end: '2026-10-01' })).isError, true);
  assert.deepEqual((await call('find_meeting_windows', { ...request, start: '2028-12-29', end: '2028-12-29' })).structuredContent.missingYears, [2028]);
});

test('compares office hours on each participant’s own local date and rejects overnight hours', async () => {
  const request = {
    start: '2026-07-13', end: '2026-07-13',
    participants: [
      { region: 'US', time_zone: 'America/Los_Angeles', work_start: '17:00', work_end: '21:00' },
      { region: 'SG', time_zone: 'Asia/Singapore', work_start: '08:00', work_end: '12:00' },
    ],
  };
  const { windows } = (await call('find_meeting_windows', request)).structuredContent;
  assert.equal(windows.length, 1);
  assert.equal(windows[0].start_utc, '2026-07-14T00:00:00Z');
  assert.equal(windows[0].participants[0].start_local, '2026-07-13T17:00:00');
  assert.equal(windows[0].participants[1].start_local, '2026-07-14T08:00:00');
  request.participants[0].work_end = '01:00';
  assert.equal((await call('find_meeting_windows', request)).isError, true);
});

test('meeting dates require coverage in each local year and reject ambiguous office boundaries', async () => {
  const crossYear = await call('find_meeting_windows', {
    start: '2025-01-01', end: '2025-01-01',
    participants: [{ region: 'FR', time_zone: 'Europe/Paris' }, { region: 'US', time_zone: 'America/Los_Angeles' }],
  });
  assert.deepEqual(crossYear.structuredContent.missingYears, [2024]);
  const ambiguous = await call('find_meeting_windows', {
    start: '2026-10-25', end: '2026-10-25',
    participants: [{ region: 'SA', time_zone: 'Europe/London', work_start: '01:30' }, { region: 'SA', time_zone: 'Asia/Riyadh' }],
  });
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.structuredContent.message, /ambiguous or nonexistent/);
});

test('health is accessible; untrusted origins, wrong methods and oversized requests are rejected', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { Origin: 'https://example.test' } })).status, 403);
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(32769) })).status, 413);
});
