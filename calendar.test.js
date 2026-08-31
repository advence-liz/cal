import { getMonthCells, monthTitle, describeDay, describeDayText, describeDayFacts, suitsActivity, ACTIVITIES } from './calendar.js';
import { formatDate } from './workday.js';
import { makeRunner } from './test-harness.js';

function makeStore() {
  const store = new Map();
  const y2026 = new Map();
  y2026.set('2026-10-01', { name: '国庆节', isOffDay: true });
  store.set(2026, y2026);
  return store;
}

export function runTests() {
  const { results, check, eq } = makeRunner();

  check('1. 2026-09 grid: 35 cells, leads with 2026-08-31 (other month)', () => {
    const cells = getMonthCells(2026, 9);
    eq(cells.length, 35);
    eq(formatDate(cells[0].date), '2026-08-31');
    eq(cells[0].otherMonth, true);
  });

  check('2. 2026-09 grid: trails with 2026-10-04 (other month)', () => {
    const cells = getMonthCells(2026, 9);
    const last = cells[cells.length - 1];
    eq(formatDate(last.date), '2026-10-04');
    eq(last.otherMonth, true);
  });

  check('3. 2026-09 grid: exactly 30 current-month cells', () => {
    const cells = getMonthCells(2026, 9);
    eq(cells.filter((c) => !c.otherMonth).length, 30);
  });

  check('4. 2026-02 grid: 28-day Feb, 35 total, leads 2026-01-26', () => {
    const cells = getMonthCells(2026, 2);
    eq(cells.length, 35);
    eq(formatDate(cells[0].date), '2026-01-26');
    eq(cells.filter((c) => !c.otherMonth).length, 28);
  });

  check('5. every grid always fills complete weeks (length % 7 === 0)', () => {
    for (const [y, m] of [[2026, 1], [2026, 2], [2027, 3], [2028, 12]]) {
      eq(getMonthCells(y, m).length % 7, 0);
    }
  });

  check('6. monthTitle formats year + Chinese month name', () => {
    eq(monthTitle(2026, 9), '2026 年 九月');
    eq(monthTitle(2026, 1), '2026 年 一月');
  });

  check('7. describeDay: holiday date resolves meta from store', () => {
    const info = describeDay('2026-10-01', makeStore());
    eq(info.meta, { name: '国庆节', isOffDay: true });
  });

  check('8. describeDay: plain weekend has no meta but dow is 0/6', () => {
    // 2026-10-03 is a Saturday.
    const info = describeDay('2026-10-03', makeStore());
    eq(info.meta, undefined);
    eq(info.dow, 6);
  });

  check('9. describeDayText: holiday line takes priority', () => {
    const info = describeDay('2026-10-01', makeStore());
    const lines = describeDayText(info);
    eq(lines[0], '国庆节 · 法定假');
  });

  check('10. describeDayText: plain workday falls back to "工作日"', () => {
    // 2026-09-01 is a Tuesday with no holiday meta.
    const info = describeDay('2026-09-01', makeStore());
    const lines = describeDayText(info);
    eq(lines[0], '工作日');
  });

  check('15. describeDayFacts: 寒露节气有科普条目', () => {
    const info = describeDay('2026-10-08', makeStore());
    const facts = describeDayFacts(info);
    eq(facts.some((f) => f.term === '寒露'), true);
  });

  check('16. describeDayFacts: 中秋节有科普条目', () => {
    const info = describeDay('2026-09-25', makeStore());
    const facts = describeDayFacts(info);
    eq(facts.some((f) => f.term === '中秋节'), true);
  });

  check('17. describeDayFacts: 普通工作日没有科普条目', () => {
    const info = describeDay('2026-09-01', makeStore());
    eq(describeDayFacts(info).length, 0);
  });

  check('11. suitsActivity: 2026-10-01 是宜"出行"的日子', () => {
    const info = describeDay('2026-10-01', makeStore());
    eq(suitsActivity(info, '出行'), true);
  });

  check('12. suitsActivity: 2026-10-01 不宜"嫁娶"（在忌里）', () => {
    const info = describeDay('2026-10-01', makeStore());
    eq(suitsActivity(info, '嫁娶'), false);
  });

  check('13. suitsActivity: 空 term 一律不高亮', () => {
    const info = describeDay('2026-10-01', makeStore());
    eq(suitsActivity(info, ''), false);
  });

  check('14. ACTIVITIES 里每个 term 都是真实黄历词条（跟当天宜/忌之一对得上或都不对，但不能是 undefined）', () => {
    const info = describeDay('2026-10-01', makeStore());
    for (const a of ACTIVITIES) {
      eq(typeof a.term, 'string');
      eq(a.term.length > 0, true);
    }
    eq(info.lunarInfo.yi.length > 0, true);
  });

  return results;
}
