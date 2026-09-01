import { suggestLeavePlans } from './bridge-plan.js';
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

  check('1. budget<=0 返回空数组', () => {
    eq(suggestLeavePlans(makeStore(), { fromDate: '2026-09-01', budget: 0 }), []);
    eq(suggestLeavePlans(makeStore(), { fromDate: '2026-09-01', budget: -1 }), []);
  });

  check('2. 请假 3 天可以把中秋和国庆拼成 13 天连休', () => {
    const plans = suggestLeavePlans(makeStore(), { fromDate: '2026-09-01', budget: 3 });
    const top = plans[0];
    eq(top.cost, 3);
    eq(top.totalDays, 13);
    eq(top.start, '2026-09-25');
    eq(top.end, '2026-10-07');
    eq(top.leaveDates, ['2026-09-28', '2026-09-29', '2026-09-30']);
    eq(top.names.includes('中秋节') && top.names.includes('国庆节'), true);
  });

  check('3. 从中秋和国庆两个方向推出的是同一个方案，去重后只出现一次', () => {
    const plans = suggestLeavePlans(makeStore(), { fromDate: '2026-09-01', budget: 3 });
    const dupes = plans.filter((p) => p.start === '2026-09-25' && p.end === '2026-10-07');
    eq(dupes.length, 1);
  });

  check('4. 预算不够桥接缺口时，不推荐这个假期（不做"半吊子"建议）', () => {
    const plans = suggestLeavePlans(makeStore(), { fromDate: '2026-09-01', budget: 1 });
    eq(plans.length, 0);
  });

  check('5. 预算变大后连休天数只增不减（越花越值）', () => {
    const p3 = suggestLeavePlans(makeStore(), { fromDate: '2026-09-01', budget: 3 })[0];
    const p8 = suggestLeavePlans(makeStore(), { fromDate: '2026-09-01', budget: 8 })[0];
    eq(p8.totalDays >= p3.totalDays, true);
    eq(p8.cost <= 8, true);
  });

  check('6. 结果按连休天数从多到少排序', () => {
    const plans = suggestLeavePlans(makeStore(), { fromDate: '2026-09-01', budget: 8 });
    for (let i = 1; i < plans.length; i++) {
      eq(plans[i - 1].totalDays >= plans[i].totalDays, true);
    }
  });

  return results;
}
