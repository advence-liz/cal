import { suggestHolidayOpportunities } from './bridge-plan.js';
import { makeRunner } from './test-harness.js';

// 中秋(9-25~9-27) + 3 天工作日缺口(9-28~9-30) + 国庆(10-1~10-7)：
// 这是真实 2026 年历法关系，也是"请三休十三"经典案例的最小复现。
function makeStore() {
  const store = new Map();
  const y2026 = new Map();
  const set = (date, name, isOffDay) => y2026.set(date, { name, isOffDay });
  set('2026-09-20', '国庆节', false); // 调休上班，落在周日
  set('2026-09-25', '中秋节', true);
  set('2026-09-26', '中秋节', true);
  set('2026-09-27', '中秋节', true);
  set('2026-10-01', '国庆节', true);
  set('2026-10-02', '国庆节', true);
  set('2026-10-03', '国庆节', true);
  set('2026-10-04', '国庆节', true);
  set('2026-10-05', '国庆节', true);
  set('2026-10-06', '国庆节', true);
  set('2026-10-07', '国庆节', true);
  set('2026-10-10', '国庆节', false); // 调休上班，落在周六
  store.set(2026, y2026);
  return store;
}

export function runTests() {
  const { results, check, eq } = makeRunner();

  check('1. 不限天数时，中秋+国庆合并成性价比最高的方案：请3天连休13天', () => {
    const list = suggestHolidayOpportunities(makeStore(), { fromDate: '2026-09-01' });
    eq(list.length, 1);
    const row = list[0];
    eq(row.recommended.cost, 3);
    eq(row.recommended.totalDays, 13);
    eq(row.recommended.start, '2026-09-25');
    eq(row.recommended.end, '2026-10-07');
    eq(row.recommended.leaveDates, ['2026-09-28', '2026-09-29', '2026-09-30']);
    eq(row.recommended.names.includes('中秋节') && row.recommended.names.includes('国庆节'), true);
  });

  check('2. 自然连休天数取两个假期里较长的那个（国庆 7 天）', () => {
    const list = suggestHolidayOpportunities(makeStore(), { fromDate: '2026-09-01' });
    eq(list[0].naturalDays, 7);
  });

  check('3. 请假上限太小桥不动缺口时，两个假期各自独立展示，不推荐方案', () => {
    const list = suggestHolidayOpportunities(makeStore(), { fromDate: '2026-09-01', maxLeaveDays: 1 });
    eq(list.length, 2);
    eq(list.every((r) => r.recommended === null), true);
    eq(list[0].naturalDays, 3); // 中秋，日期更早排在前面
    eq(list[1].naturalDays, 7); // 国庆
  });

  check('4. 上限刚好覆盖缺口时才出现合并方案', () => {
    const list = suggestHolidayOpportunities(makeStore(), { fromDate: '2026-09-01', maxLeaveDays: 3 });
    eq(list.length, 1);
    eq(list[0].recommended.totalDays, 13);
  });

  check('5. 不传 maxLeaveDays 等价于不限', () => {
    const withCap = suggestHolidayOpportunities(makeStore(), { fromDate: '2026-09-01', maxLeaveDays: 999 });
    const noCap = suggestHolidayOpportunities(makeStore(), { fromDate: '2026-09-01' });
    eq(withCap, noCap);
  });

  check('6. 结果按日期从早到晚排序', () => {
    const list = suggestHolidayOpportunities(makeStore(), { fromDate: '2026-09-01', maxLeaveDays: 1 });
    for (let i = 1; i < list.length; i++) {
      eq(list[i - 1].naturalStart <= list[i].naturalStart, true);
    }
  });

  return results;
}
