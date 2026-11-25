const DAY_MS = 86_400_000;
const dayNumber = date => Date.parse(date) / DAY_MS; // ISO civil dates map to UTC midnight.
const weekday = day => ((day + 4) % 7 + 7) % 7; // Day zero was a Thursday.

// Inputs are validated ISO dates; the caller checks coverage before counting.
export function countSnapshotWorkdays(start, end, store, weekendDays = [0, 6]) {
  const first = dayNumber(start);
  const length = dayNumber(end) - first + 1;
  let count = Math.floor(length / 7) * (7 - weekendDays.length);
  const startWeekday = weekday(first);
  for (let i = 0; i < length % 7; i++) {
    if (!weekendDays.includes((startWeekday + i) % 7)) count++;
  }

  // Snapshots contain only exceptions to the workweek. An override on a day
  // already counted the same way (e.g. a Saturday holiday) changes nothing.
  const lastYear = Number(end.slice(0, 4));
  for (let year = Number(start.slice(0, 4)); year <= lastYear; year++) {
    const rows = store.get(year);
    if (!rows) continue;
    for (const [date, { isOffDay }] of rows) {
      if (date < start || date > end) continue;
      const normallyWorks = !weekendDays.includes(weekday(dayNumber(date)));
      count += Number(isOffDay === false) - Number(normallyWorks);
    }
  }
  return count;
}
