import { civilDate, dayNumber, missingSnapshotYears, snapshotDateInfo } from './range-workdays.mjs';
import { localDayStart, localInstant, utcTime, zonedInstant } from './time-zones.mjs';

const MINUTE_MS = 60_000;
const dateAt = (instant, timeZone) => zonedInstant(instant, timeZone).toPlainDate().toString();

function overlap(left, right) {
  const result = [];
  for (let i = 0, j = 0; i < left.length && j < right.length;) {
    const start = Math.max(left[i][0], right[j][0]);
    const end = Math.min(left[i][1], right[j][1]);
    if (start < end) result.push([start, end]);
    if (left[i][1] <= right[j][1]) i++;
    else j++;
  }
  return result;
}

function officeBoundary(date, clock, timeZone) {
  try { return localInstant(`${date}T${clock}`, timeZone).epochMilliseconds; }
  catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new RangeError(`The office-hour boundary ${date}T${clock} is ambiguous or nonexistent in ${timeZone}. Choose different local work hours.`);
  }
}

export function meetingWindows(start, end, participants, durationMinutes) {
  if (participants.some(p => p.work_start >= p.work_end)) {
    throw new RangeError('Work hours must start and end on the same local day, with work_start before work_end.');
  }
  const anchor = participants[0].time_zone;
  const from = localDayStart(start, anchor);
  const until = localDayStart(civilDate(dayNumber(end) + 1), anchor);
  if (from >= until) return { windows: [] };
  // Check all participants' coverage before returning any recommendation. Their
  // local dates can differ from the anchor range on either side of midnight.
  const schedules = participants.map(p => {
    const first = dateAt(from, p.time_zone), last = dateAt(until - 1, p.time_zone);
    return { ...p, first, last, missingYears: missingSnapshotYears(first, last, p.store) };
  });
  const missing = schedules.filter(p => p.missingYears.length);
  if (missing.length) return { missing };

  let common = [[from, until]];
  for (const { first, last, time_zone, work_start, work_end, store, weekendDays } of schedules) {
    const intervals = [];
    for (let day = dayNumber(first); day <= dayNumber(last); day++) {
      const date = civilDate(day);
      if (!snapshotDateInfo(date, day, store, weekendDays).workday) continue;
      const startAt = officeBoundary(date, work_start, time_zone);
      const endAt = officeBoundary(date, work_end, time_zone);
      intervals.push([startAt, endAt]);
    }
    common = overlap(common, intervals);
    if (!common.length) break;
  }
  return { windows: common.filter(([a, b]) => b - a >= durationMinutes * MINUTE_MS).map(([a, b]) => ({
    start_utc: utcTime(a), end_utc: utcTime(b), duration_minutes: Math.floor((b - a) / MINUTE_MS),
    participants: participants.map(({ region, time_zone }) => {
      const startAt = zonedInstant(a, time_zone), endAt = zonedInstant(b, time_zone);
      return { region, time_zone, start_local: startAt.toPlainDateTime().toString(), end_local: endAt.toPlainDateTime().toString(), start_offset: startAt.offset, end_offset: endAt.offset };
    }),
  })) };
}
