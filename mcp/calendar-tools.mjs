import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { DEFAULT_REGION, REGIONS } from '../holidays.js';
import { countSnapshotWorkdays } from './range-workdays.mjs';

export const MAX_BODY = 32 * 1024;
export const MAX_IN_FLIGHT = 32;
const REGION = z.enum(Object.keys(REGIONS));
const YEAR = z.number().int().min(1900).max(2100);
const DATE = z.iso.date().refine(value => YEAR.safeParse(Number(value.slice(0, 4))).success, 'Supported years: 1900–2100');
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
    const missing = [];
    for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
      if (!store.has(year)) missing.push(year);
    }
    if (missing.length) return failure(`Missing verified holiday data for ${region}.`, missing);
    return format({ region, start, end, workdays: countSnapshotWorkdays(start, end, store, REGIONS[region].weekendDays) });
  });
  return mcp;
}
