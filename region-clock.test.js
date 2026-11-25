import { makeRunner } from './test-harness.js';

export async function runTests() {
  const { results, checkAsync, eq } = makeRunner();
  await checkAsync('北京时间与新加坡时间同为 UTC+8，跨午夜正确显示 00:00', async () => {
    const { regionClock } = await import('./region-clock.js');
    const instant = new Date('2026-11-24T16:00:00Z');
    eq(regionClock('CN', instant), { time: '00:00', offset: 'UTC+8' });
    eq(regionClock('SG', instant), { time: '00:00', offset: 'UTC+8' });
  });
  await checkAsync('纽约在夏令时切换点从 01:59 跳到 03:00，偏移也随之变更', async () => {
    const { regionClock } = await import('./region-clock.js');
    eq(regionClock('US', new Date('2026-03-08T06:59:00Z')), { time: '01:59', offset: 'UTC−5' });
    eq(regionClock('US', new Date('2026-03-08T07:00:00Z')), { time: '03:00', offset: 'UTC−4' });
  });
  await checkAsync('跟随假期地区或手动覆盖，支持 UTC 和半小时时区', async () => {
    const { regionClock, clockZoneFor } = await import('./region-clock.js');
    eq(clockZoneFor('JP', 'auto'), 'JP');
    eq(clockZoneFor('GB', 'US_WEST'), 'US_WEST');
    eq(clockZoneFor('SG', 'invalid'), 'SG');
    const instant = new Date('2026-11-24T16:00:00Z');
    eq(regionClock('UTC', instant), { time: '16:00', offset: 'UTC' });
    eq(regionClock('IN', instant), { time: '21:30', offset: 'UTC+5:30' });
    eq(regionClock('JP', instant), { time: '01:00', offset: 'UTC+9' });
    eq(regionClock('GB', new Date('2026-07-01T12:00:00Z')), { time: '13:00', offset: 'UTC+1' });
  });
  return results;
}
