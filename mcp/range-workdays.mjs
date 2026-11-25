const DAY_MS = 86_400_000;
export const dayNumber = date => Date.parse(date) / DAY_MS; // ISO civil dates map to UTC midnight.
const weekday = day => ((day + 4) % 7 + 7) % 7; // Day zero was a Thursday.

export function missingSnapshotYears(start, end, store) {
  const missing = [];
  const last = Number(end.slice(0, 4));
  for (let year = Number(start.slice(0, 4)); year <= last; year++) {
    if (!store.has(year)) missing.push(year);
  }
  return missing;
}

export function snapshotDateInfo(date, day, store, weekendDays = [0, 6]) {
  const meta = store.get(Number(date.slice(0, 4)))?.get(date);
  return { workday: meta ? meta.isOffDay === false : !weekendDays.includes(weekday(day)), holiday: meta?.isOffDay === true ? meta : null };
}

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

export const civilDate = day => new Date(day * DAY_MS).toISOString().slice(0, 10);

// Consume whole verified years, then binary-search the year containing the result.
export function addSnapshotWorkdays(start, n, store, weekendDays) {
  const startYear = Number(start.slice(0, 4));
  if (!store.has(startYear)) return { missingYear: startYear };
  if (n === 0) return { end: start };

  const step = Math.sign(n);
  let remaining = Math.abs(n);
  let first = dayNumber(start) + step;
  while (true) {
    const from = civilDate(first);
    const yearText = from.slice(0, 4);
    const year = Number(yearText);
    if (!store.has(year)) return { missingYear: year };
    const boundary = dayNumber(step > 0 ? `${yearText}-12-31` : `${yearText}-01-01`);
    const countTo = date => step > 0
      ? countSnapshotWorkdays(from, date, store, weekendDays)
      : countSnapshotWorkdays(date, from, store, weekendDays);
    const available = countTo(civilDate(boundary));
    if (remaining > available) {
      remaining -= available;
      first = boundary + step;
      continue;
    }

    let min = 0, max = Math.abs(boundary - first);
    while (min < max) {
      const mid = Math.floor((min + max) / 2);
      if (countTo(civilDate(first + step * mid)) < remaining) min = mid + 1;
      else max = mid;
    }
    return { end: civilDate(first + step * min) };
  }
}
