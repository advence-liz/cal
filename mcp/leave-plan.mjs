import { civilDate, dayNumber, snapshotDateInfo } from './range-workdays.mjs';

export function suggestLeavePlan(start, end, maxLeaveDays, store, weekendDays) {
  const first = dayNumber(start), last = dayNumber(end);
  const days = [];
  let left = 0, cost = 0, lastHoliday = -1, best = null;
  for (let day = first; day <= last; day++) {
    const date = civilDate(day);
    const { workday, holiday } = snapshotDateInfo(date, day, store, weekendDays);
    const right = days.push({ date, workday, holiday }) - 1;
    if (holiday) lastHoliday = right;
    cost += Number(workday);
    while (cost > maxLeaveDays) cost -= Number(days[left++].workday);
    if (lastHoliday < left) continue; // Do not recommend ordinary weekends as holiday breaks.
    const length = right - left + 1;
    if (!best || length > best.length || (length === best.length && cost < best.cost)) {
      best = { left, right, length, cost };
    }
  }
  if (!best) return null;
  const chosen = days.slice(best.left, best.right + 1);
  return {
    start: chosen[0].date,
    end: chosen.at(-1).date,
    totalDays: chosen.length,
    leaveDates: chosen.filter(d => d.workday).map(d => d.date),
    holidays: chosen.filter(d => d.holiday).map(d => ({ date: d.date, name: d.holiday.name })),
  };
}
