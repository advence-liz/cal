import { loadYears, getDataStore, REGIONS } from './holidays.js';
import { addWorkdays, countWorkdays, isWorkday, nextHolidays } from './workday.js';
import * as bridgePlan from './bridge-plan.js';
import { describeDay, describeDayText, renderMonth } from './calendar.js';
import { clockZoneFor, regionClock } from './region-clock.js';
import { holidayLabel, getLanguage, setLanguage } from './i18n.js';
import { makeRunner } from './test-harness.js';

// Integration-style suite: fetches real files over HTTP, so it needs the
// local test server (run-tests.mjs provides it). localStorage keys are
// cleared first so the 7-day TTL cache can't mask the load path under test.
export async function runTests() {
  const { results, check, checkAsync, eq } = makeRunner();

  check('0. 前置：清掉 localStorage 的 TTL 缓存', () => {
    for (const y of [2026, 2027, 2099]) localStorage.removeItem(`holiday-cn:${y}`);
  });

  await checkAsync('1. 本地 vendored 数据优先：2026 年来自同源文件', async () => {
    const [r] = await loadYears([2026]);
    eq(r.source, 'local');
    eq(r.error, undefined);
  });

  await checkAsync('2. vendored 数据内容正确：2026 元旦是休息日', async () => {
    const store = getDataStore().get(2026);
    eq(store.get('2026-01-01'), { name: '元旦', isOffDay: true });
  });

  await checkAsync('3. 本地 vendored 数据优先：2027 年也走同源文件', async () => {
    const [r] = await loadYears([2027]);
    eq(r.source, 'local');
    const store = getDataStore().get(2027);
    eq(store.get('2027-02-06'), { name: '春节', isOffDay: true });
  });

  await checkAsync('4. 兜底路径：本地缺失且上游未发布的年份 → failed，不假装有数据', async () => {
    const [r] = await loadYears([2099]);
    eq(r.source, 'failed');
    eq(getDataStore().has(2099), false);
  });

  await checkAsync('5. TTL 缓存命中：再次加载同一年直接用缓存（source=cache）', async () => {
    const [r] = await loadYears([2026]); // 前面已写过 fetchedAt=now 的缓存
    eq(r.source, 'cache');
  });

  await checkAsync('6. 三国同年并发加载，不串用数据或缓存', async () => {
    const results = await Promise.all(['CN', 'US', 'SG'].map((region) => loadYears([2027], region)));
    eq(results.slice(1).map(([r]) => r.source), ['local', 'local']);
    const cn = getDataStore('CN');
    const us = getDataStore('US');
    const sg = getDataStore('SG');
    eq(cn.get(2027).get('2027-01-31').isOffDay, false);
    eq(us.get(2027).has('2027-02-08'), false);
    eq(sg.get(2027).has('2027-02-08'), true);
    eq(cn.get(2027).has('2027-12-31'), false);
  });

  await checkAsync('7. 美国：2028 元旦的补休归入 2027，且不与 2027 元旦去重', async () => {
    const us = getDataStore('US');
    eq(us.get(2027).get('2027-12-31').observedFor, '2028-01-01');
    eq(us.get(2027).get('2027-07-05').observedFor, '2027-07-04');
    eq(countWorkdays('2027-12-30', '2027-12-31', us), 1);
    eq(nextHolidays('2026-12-31', new Map([[2027, us.get(2027)]]), 20)
      .filter((h) => h.name === '元旦').map((h) => h.date), ['2027-01-01', '2027-12-31']);
    eq(us.get(2025).get('2025-01-20').name, '马丁·路德·金纪念日');
  });

  await checkAsync('8. 新加坡：周日补休、周六不自动补休；拼假也用同一口径', async () => {
    const sg = getDataStore('SG');
    eq(sg.get(2027).get('2027-02-08').observedFor, '2027-02-07');
    eq(describeDayText(describeDay('2027-02-08', sg))[0], '春节 · 补休（原节日 2027-02-07）');
    eq(addWorkdays('2027-02-05', 1, sg), '2027-02-09');
    eq(addWorkdays('2027-04-30', 1, sg), '2027-05-03');
    const [plan] = bridgePlan.suggestHolidayOpportunities(sg, { fromDate: '2027-02-05', horizonDays: 10 });
    eq([plan.naturalStart, plan.naturalEnd, plan.naturalDays], ['2027-02-06', '2027-02-08', 3]);
    eq(sg.get(2025).get('2025-05-03').name, '投票日');
  });

  await checkAsync('9. 超出数据范围不借用别国数据，拼假扫描停在缺年之前', async () => {
    const [r] = await loadYears([2099], 'SG');
    eq(r.source, 'unavailable');
    const sg = getDataStore('SG');
    eq(sg.has(2099), false);
    // Test a deliberately bounded store; new official years should not break CI.
    const through2027 = new Map([[2027, sg.get(2027)]]);
    eq(bridgePlan.coveredDays('2027-12-30', 400, through2027), 2);
    eq(bridgePlan.coveredDays('2028-01-01', 400, through2027), 0);
  });

  await checkAsync('日本与英格兰及威尔士独立加载，补休参与工作日计算', async () => {
    const results = await Promise.all(['JP', 'GB'].map((region) => loadYears([2027], region)));
    eq(results.map(([r]) => r.source), ['local', 'local']);
    const jp = getDataStore('JP');
    const gb = getDataStore('GB');
    eq(jp.get(2027).get('2027-03-22').observedFor, '2027-03-21');
    eq(jp.get(2026).get('2026-09-22').name, '国民休息日');
    eq(gb.get(2027).get('2027-12-28').observedFor, '2027-12-26');
    eq(addWorkdays('2027-12-24', 1, gb), '2027-12-29');
  });

  await checkAsync('法国与南非按各自口径处理周日假期', async () => {
    const results = await Promise.all(['FR', 'ZA'].map((region) => loadYears([2026, 2027], region)));
    eq(results.map((years) => years.map((r) => r.source)), [['local', 'local'], ['local', 'local']]);
    const fr = getDataStore('FR');
    const za = getDataStore('ZA');
    eq(fr.get(2026).get('2026-11-01').name, '诸圣节');
    eq(addWorkdays('2026-10-30', 1, fr), '2026-11-02');
    eq(za.get(2027).get('2027-12-27').observedFor, '2027-12-26');
    eq(addWorkdays('2027-12-24', 1, za), '2027-12-28');
  });

  await checkAsync('印度按德里中央机关公告，巴西不把弹性休假算成全国假日', async () => {
    const results = await Promise.all(['IN', 'BR'].map((region) => loadYears([2026, 2027], region)));
    eq(results.map((years) => years.map((r) => r.source)), [['local', 'local'], ['local', 'local']]);
    const india = getDataStore('IN');
    const brazil = getDataStore('BR');
    eq(addWorkdays('2026-05-26', 1, india), '2026-05-27');
    eq(addWorkdays('2026-05-27', 1, india), '2026-05-29');
    eq(india.get(2027).get('2027-08-15').name, '印度独立日、圣纪节');
    eq(brazil.get(2026).get('2026-11-20').name, '黑人意识日');
    eq(addWorkdays('2026-02-13', 1, brazil), '2026-02-16');
    eq(addWorkdays('2026-11-19', 1, brazil), '2026-11-23');
  });

  check('沙特银行周末：周五、周六休息，周日工作；缺年时仍按同一周末估算', () => {
    const { weekendDays } = REGIONS.SA;
    const empty = new Map();
    eq(['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']
      .map((date) => isWorkday(date, empty, weekendDays)), [true, false, false, true]);
    eq(countWorkdays('2026-09-24', '2026-09-27', empty, weekendDays), 2);
    eq(addWorkdays('2026-09-24', 1, empty, weekendDays), '2026-09-27');
    eq(addWorkdays('2026-09-27', -1, empty, weekendDays), '2026-09-24');
    const overrides = new Map([[2026, new Map([['2026-09-25', { isOffDay: false }]])]]);
    eq(isWorkday('2026-09-25', overrides, weekendDays), true);
  });

  check('沙特银行月历表头、日期详情和拼假使用一致的周末规则', () => {
    const { weekendDays } = REGIONS.SA;
    const store = new Map([[2026, new Map([['2026-09-24', { name: '假日', isOffDay: true }]])]]);
    const options = { showLunar: false, weekendDays };
    const grid = document.createElement('div');
    for (const dow of [1, 2, 3, 4, 5, 6, 0]) {
      const head = document.createElement('div');
      head.className = 'cal-head';
      head.dataset.weekday = dow;
      grid.append(head);
    }
    renderMonth(2026, 9, grid, store, '2026-09-21', '', '', null, options);
    eq([...grid.querySelectorAll('.cal-head--weekend')].map((cell) => cell.dataset.weekday), ['5', '6']);
    eq(grid.querySelector('[data-date="2026-09-25"]').classList.contains('day--weekend'), true);
    eq(grid.querySelector('[data-date="2026-09-27"]').classList.contains('day--weekend'), false);
    eq(describeDayText(describeDay('2026-09-27', store, options))[0], '工作日');
    const [plan] = bridgePlan.suggestHolidayOpportunities(store, { fromDate: '2026-09-23', horizonDays: 8, weekendDays });
    eq([plan.naturalStart, plan.naturalEnd, plan.naturalDays], ['2026-09-24', '2026-09-26', 3]);
    renderMonth(2026, 9, grid, store, '2026-09-21', '', '', null, { showLunar: false });
    eq([...grid.querySelectorAll('.cal-head--weekend')].map((cell) => cell.dataset.weekday), ['6', '0']);
  });

  await checkAsync('新南威尔士州和沙特银行数据、补休和地区时钟各自独立', async () => {
    const [[au], [sa, sa2028]] = await Promise.all([loadYears([2027], 'AU'), loadYears([2026, 2028], 'SA')]);
    eq([au.source, sa.source, sa2028.source], ['local', 'local', 'local']);
    const nsw = getDataStore('AU');
    const saudi = getDataStore('SA');
    eq(nsw.get(2027).get('2027-04-26').observedFor, '2027-04-25');
    eq(nsw.get(2027).has('2027-08-02'), false); // Bank-only holiday
    eq(saudi.get(2026).get('2026-03-23').name, '沙特开斋节');
    eq(saudi.get(2026).has('2026-03-24'), false);
    eq(saudi.get(2028).get('2028-09-24').observedFor, '2028-09-23');
    eq(addWorkdays('2028-09-21', 1, saudi, REGIONS.SA.weekendDays), '2028-09-25');
    eq(clockZoneFor('AU', 'auto'), 'AU');
    eq(clockZoneFor('SA', 'auto'), 'SA');
    eq(regionClock('SA', new Date('2026-09-23T00:00:00Z')), { time: '03:00', offset: 'UTC+3' });
  });

  await checkAsync('10. 英文界面翻译所有已收录的假日，不修改原始数据', async () => {
    const saved = getLanguage();
    try {
      setLanguage('en');
      for (const region of ['CN', 'US', 'SG', 'JP', 'GB', 'FR', 'ZA', 'IN', 'BR', 'AU', 'SA']) {
        await loadYears([2025, 2026, 2027], region);
        for (const yearStore of getDataStore(region).values()) {
          for (const { name } of yearStore.values()) eq(/[㐀-鿿]/u.test(holidayLabel(name)), false);
        }
      }
      eq(holidayLabel('国庆节、中秋节'), 'National Day / Mid-Autumn Festival');
      const day = describeDay('2027-02-08', getDataStore('SG'));
      eq(describeDayText(day)[0], 'Chinese New Year · Observed (original date 2027-02-07)');
      eq(day.meta.name, '春节');
    } finally {
      setLanguage(saved);
    }
  });

  return results;
}
