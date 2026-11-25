import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { DEFAULT_REGION, REGIONS } from '../holidays.js';
import { addSnapshotWorkdays, countSnapshotWorkdays, dayNumber, missingSnapshotYears } from './range-workdays.mjs';
import { convertTimeZone, localTimes } from './time-zones.mjs';
import { suggestLeavePlan } from './leave-plan.mjs';
import { meetingWindows } from './meeting-windows.mjs';

export const MAX_BODY = 32 * 1024;
export const MAX_IN_FLIGHT = 32;
const REGION = z.enum(Object.keys(REGIONS));
const YEAR = z.number().int().min(1900).max(2100);
const DATE = z.iso.date().refine(value => YEAR.safeParse(Number(value.slice(0, 4))).success, 'Supported years: 1900–2100');
const DATETIME = z.iso.datetime({ local: true, offset: true }).max(40)
  .or(z.iso.datetime({ local: true, offset: true, precision: -1 }))
  .refine(value => YEAR.safeParse(Number(value.slice(0, 4))).success, 'Supported years: 1900–2100');
const TIME_ZONE = z.string().max(64).regex(/^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)*$/, 'Use an IANA time zone such as Asia/Shanghai or UTC');
const OFFICE_TIME = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm in 24-hour time');
const PARTICIPANT = z.object({
  region: REGION, time_zone: TIME_ZONE, work_start: OFFICE_TIME.default('09:00'), work_end: OFFICE_TIME.default('18:00'),
}).strict();
const hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const format = data => ({ structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] });
const failure = (message, missingYears = []) => ({ ...format({ message, missingYears }), isError: true });

export function indexSnapshots(files) {
  const data = new Map();
  for (const [region, info] of Object.entries(REGIONS)) {
    const entries = region === DEFAULT_REGION
      ? Object.entries(files).filter(([path]) => /^data\/holidays-\d{4}\.json$/.test(path))
        .map(([path, { days }]) => [Number(path.slice(14, 18)), days])
      : Object.entries(files[info.file].years).map(([year, days]) => [Number(year), days]);
    const store = new Map();
    for (const [year, days] of entries) {
      if (!days.length) throw new Error(`Empty ${region} snapshot for ${year}`);
      const rows = region === DEFAULT_REGION
        ? days.map(({ date, name, isOffDay }) => [date, { name, isOffDay }])
        : days.map(([date, name, observedFor]) => [date, {
          name, isOffDay: true, ...(observedFor ? { observedFor } : {}),
        }]);
      store.set(year, new Map(rows));
    }
    if (!store.size) throw new Error(`No snapshots for ${region}`);
    data.set(region, store);
  }
  return data;
}

export function tools(data) {
  const mcp = new McpServer({ name: 'moyu-calendar', version: '1.0.0' });
  mcp.registerTool('list_regions', {
    description: 'List holiday regions, their scope, weekend weekdays (0=Sunday) and verified snapshot years.',
    inputSchema: z.object({}).strict(), annotations: hints,
  }, () => format({ regions: Object.entries(REGIONS).map(([id, info]) => ({
    id, source: info.source, scope: info.scope, weekendDays: info.weekendDays ?? [0, 6],
    years: [...data.get(id).keys()].sort((a, b) => a - b),
  })) }));

  mcp.registerTool('get_holidays', {
    description: 'Get public holidays and make-up workdays for a region and a verified year. Missing years return an error, not an empty holiday list.',
    inputSchema: z.object({ region: REGION, year: YEAR }).strict(), annotations: hints,
  }, ({ region, year }) => {
    const rows = data.get(region).get(year);
    if (!rows) return failure(`No verified holiday snapshot for ${region} in ${year}.`, [year]);
    const { scope, source } = REGIONS[region];
    return format({ region, year, scope, source, days: [...rows.entries()]
      .sort(([a], [b]) => a.localeCompare(b)).map(([date, entry]) => ({ date, ...entry })) });
  });

  mcp.registerTool('count_workdays', {
    description: 'Count workdays in the inclusive YYYY-MM-DD range, honoring the regional weekend, holidays and make-up workdays. All years in the range must be verified.',
    inputSchema: z.object({ region: REGION, start: DATE, end: DATE }).strict(), annotations: hints,
  }, ({ region, start, end }) => {
    if (start > end) return failure('start must be on or before end.');
    const store = data.get(region);
    const missing = missingSnapshotYears(start, end, store);
    if (missing.length) return failure(`Missing verified holiday data for ${region}.`, missing);
    return format({ region, start, end, workdays: countSnapshotWorkdays(start, end, store, REGIONS[region].weekendDays) });
  });
  mcp.registerTool('convert_timezone', {
    description: 'Convert an ISO local date-time from one IANA time zone to another. Specify a date, not just a time. Accepts an optional UTC offset to resolve a repeated local time. Rejects nonexistent times or mismatched offsets.',
    inputSchema: z.object({ datetime: DATETIME, from_tz: TIME_ZONE, to_tz: TIME_ZONE }).strict(), annotations: hints,
  }, ({ datetime, from_tz, to_tz }) => {
    try { return format(convertTimeZone(datetime, from_tz, to_tz)); }
    catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return failure('Use valid IANA time zones and an existing local date-time. For repeated local times, include the correct UTC offset.');
    }
  });

  mcp.registerTool('add_workdays', {
    description: 'Find the date n workdays after (positive) or before (negative) start, excluding the start day. Zero returns the start. Uses verified regional holidays, weekend rules and make-up workdays; stops at unpublished years.',
    inputSchema: z.object({ region: REGION, start: DATE, n: z.number().int().min(-10000).max(10000) }).strict(), annotations: hints,
  }, ({ region, start, n }) => {
    const { end, missingYear } = addSnapshotWorkdays(start, n, data.get(region), REGIONS[region].weekendDays);
    return end ? format({ region, start, n, end }) : failure(`Missing verified holiday data for ${region}.`, [missingYear]);
  });
  mcp.registerTool('get_local_time', {
    description: 'Get current local date, time, and UTC offset for 1 to 5 IANA time zones, all for the same instant. Does not look up holidays.',
    inputSchema: z.object({ time_zones: z.array(TIME_ZONE).min(1).max(5) }).strict(), annotations: hints,
  }, ({ time_zones }) => {
    try { return format(localTimes(time_zones)); }
    catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return failure('Use valid IANA time zones such as Asia/Shanghai, America/New_York, or UTC.');
    }
  });

  mcp.registerTool('suggest_leave_plan', {
    description: 'Find the longest consecutive break containing a public holiday, within an inclusive range of up to 366 dates and the given leave-day budget. Break ties by fewer leave days, then earlier start. Returns plan: null if none; rejects unknown years.',
    inputSchema: z.object({ region: REGION, start: DATE, end: DATE, max_leave_days: z.number().int().min(0).max(30) }).strict(), annotations: hints,
  }, ({ region, start, end, max_leave_days }) => {
    const days = dayNumber(end) - dayNumber(start) + 1;
    if (days < 1 || days > 366) return failure('Choose an inclusive date range of 1–366 days.');
    const store = data.get(region);
    const missing = missingSnapshotYears(start, end, store);
    if (missing.length) return failure(`Missing verified holiday data for ${region}.`, missing);
    return format({ region, start, end, max_leave_days, plan: suggestLeavePlan(start, end, max_leave_days, store, REGIONS[region].weekendDays) });
  });

  mcp.registerTool('find_meeting_windows', {
    description: 'Find shared office-hour windows on workdays for 2–4 participants. Pass a holiday region and an IANA time zone separately for each; optional same-day work_start/work_end default to 09:00–18:00. Search 1–7 inclusive dates in the first participant’s zone. Returns available windows of at least duration_minutes, not personal calendar availability; does not book meetings.',
    inputSchema: z.object({ start: DATE, end: DATE, participants: z.array(PARTICIPANT).min(2).max(4), duration_minutes: z.number().int().min(1).max(480).default(30) }).strict(), annotations: hints,
  }, ({ start, end, participants, duration_minutes }) => {
    const days = dayNumber(end) - dayNumber(start) + 1;
    if (days < 1 || days > 7) return failure('Choose an inclusive date range of 1–7 days in the first participant’s time zone.');
    const schedules = participants.map(p => ({ ...p, store: data.get(p.region), weekendDays: REGIONS[p.region].weekendDays }));
    try {
      const { windows, missing } = meetingWindows(start, end, schedules, duration_minutes);
      if (missing) {
        const years = [...new Set(missing.flatMap(p => p.missingYears))].sort((a, b) => a - b);
        const regions = [...new Set(missing.map(p => p.region))].join(', ');
        return failure(`Missing verified holiday data for ${regions}.`, years);
      }
      return format({ start, end, anchor_time_zone: participants[0].time_zone, duration_minutes, windows });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return failure(error.message);
    }
  });
  return mcp;
}
