import {
  isWorkday,
  countWorkdays,
  addWorkdays,
  nextHoliday,
} from './workday.js';
import { makeRunner } from './test-harness.js';

function makeStore() {
  const store = new Map();
  const y2026 = new Map();
  y2026.set('2026-06-19', { name: '端午节', isOffDay: true });
  y2026.set('2026-09-26', { name: '中秋节', isOffDay: false });
  y2026.set('2026-09-27', { name: '中秋节', isOffDay: true });
  y2026.set('2026-10-01', { name: '国庆节', isOffDay: true });
  y2026.set('2026-10-02', { name: '国庆节', isOffDay: true });
  y2026.set('2026-10-03', { name: '国庆节', isOffDay: true });
  y2026.set('2026-10-04', { name: '国庆节', isOffDay: true });
  y2026.set('2026-10-05', { name: '国庆节', isOffDay: true });
  y2026.set('2026-10-06', { name: '国庆节', isOffDay: true });
  y2026.set('2026-10-07', { name: '国庆节', isOffDay: true });
  y2026.set('2026-10-11', { name: '国庆节', isOffDay: false });
  store.set(2026, y2026);
  return store;
}

export function runTests() {
  const { results, check, eq, throws } = makeRunner();
  const store = makeStore();

  check('1. isWorkday holiday (端午 6/19 Fri)', () =>
    eq(isWorkday('2026-06-19', store), false));

  check('2. isWorkday plain weekend (6/20 Sat)', () =>
    eq(isWorkday('2026-06-20', store), false));

  check('3. isWorkday makeup (中秋补班 9/26 Sat)', () =>
    eq(isWorkday('2026-09-26', store), true));

  check('4. countWorkdays 2026-06 = 21', () =>
    eq(countWorkdays('2026-06-01', '2026-06-30', store), 21));

  check('5. countWorkdays start>end throws', () =>
    throws(() => countWorkdays('2026-06-30', '2026-06-01', store)));

  check('6. addWorkdays(6/8, +5) = 6/15', () =>
    eq(addWorkdays('2026-06-08', 5, store), '2026-06-15'));

  check('7. addWorkdays(6/8, 0) = 6/8 itself', () =>
    eq(addWorkdays('2026-06-08', 0, store), '2026-06-08'));

  check('8. addWorkdays(6/15, -5) = 6/8', () =>
    eq(addWorkdays('2026-06-15', -5, store), '2026-06-08'));

  check('9. addWorkdays(6/17, +3) skips 端午 = 6/23', () =>
    eq(addWorkdays('2026-06-17', 3, store), '2026-06-23'));

  check('10. nextHoliday(6/8) = 端午节 6/19, 11d', () =>
    eq(nextHoliday('2026-06-08', store), {
      name: '端午节', date: '2026-06-19', daysAway: 11,
    }));

  return results;
}
