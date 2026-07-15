// Pure workday utilities. No DOM, no I/O. dataStore shape:
//   Map<year:number, Map<dateStr:'YYYY-MM-DD', {name, isOffDay}>>

export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

function getMeta(dateStr, store) {
  const year = Number(dateStr.slice(0, 4));
  const yearMap = store.get(year);
  return yearMap ? yearMap.get(dateStr) : undefined;
}

export function isWorkday(dateStr, store) {
  const meta = getMeta(dateStr, store);
  if (meta) return meta.isOffDay === false;
  const dow = parseDate(dateStr).getDay(); // 0=Sun, 6=Sat
  return dow !== 0 && dow !== 6;
}

export function countWorkdays(startStr, endStr, store) {
  if (startStr > endStr) {
    throw new Error('起始日期不能晚于结束日期');
  }
  let count = 0;
  let cursor = startStr;
  while (cursor <= endStr) {
    if (isWorkday(cursor, store)) count++;
    cursor = addDays(cursor, 1);
  }
  return count;
}

export function addWorkdays(startStr, n, store) {
  if (n === 0) return startStr;
  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  let cursor = startStr;
  while (remaining > 0) {
    cursor = addDays(cursor, step);
    if (isWorkday(cursor, store)) remaining--;
  }
  return cursor;
}

// Returns the next distinct legal holiday (isOffDay=true) whose first day is strictly after `fromStr`.
// Distinct = grouped by name + earliest occurrence.
export function nextHoliday(fromStr, store) {
  const firstByName = new Map();
  for (const yearMap of store.values()) {
    for (const [dateStr, meta] of yearMap) {
      if (!meta.isOffDay) continue;
      if (dateStr <= fromStr) continue;
      const prev = firstByName.get(meta.name);
      if (!prev || dateStr < prev) firstByName.set(meta.name, dateStr);
    }
  }
  let best = null;
  for (const [name, date] of firstByName) {
    if (!best || date < best.date) best = { name, date };
  }
  if (!best) return null;
  const days = Math.round(
    (parseDate(best.date) - parseDate(fromStr)) / 86400000
  );
  return { name: best.name, date: best.date, daysAway: days };
}
