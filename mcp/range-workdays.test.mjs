import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { REGIONS } from '../holidays.js';
import { addDays, countWorkdays } from '../workday.js';
import { indexSnapshots } from './calendar-tools.mjs';
import { countSnapshotWorkdays } from './range-workdays.mjs';

const dataDir = new URL('../data/', import.meta.url);

async function snapshots() {
  const names = (await readdir(dataDir)).filter(name => /^holidays-(?:\d{4}|[a-z]{2})\.json$/.test(name));
  return indexSnapshots(Object.fromEntries(await Promise.all(names.map(async name => [
    `data/${name}`, JSON.parse(await readFile(new URL(name, dataDir), 'utf8')),
  ]))));
}

test('inclusive week arithmetic matches the daily reference for both weekend conventions and pre-epoch dates', () => {
  const store = new Map();
  for (const anchor of ['1900-01-01', '1969-12-27', '2028-02-25', '2026-03-06', '2026-10-23']) {
    for (const weekend of [[0, 6], [5, 6]]) {
      for (let offset = 0; offset < 7; offset++) {
        const start = addDays(anchor, offset);
        for (let days = 0; days < 22; days++) {
          const end = addDays(start, days);
          assert.equal(countSnapshotWorkdays(start, end, store, weekend), countWorkdays(start, end, store, weekend), `${start} to ${end}; weekend ${weekend}`);
        }
      }
    }
  }
});

test('holiday and make-up overrides affect only their own dates and only when they change the base workweek', () => {
  const store = new Map([[2027, new Map([
    ['2027-01-01', { isOffDay: true }], // Friday would normally be a workday.
    ['2027-01-02', { isOffDay: true }], // Saturday remains off.
    ['2027-01-03', { isOffDay: false }], // Sunday make-up workday.
    ['2027-01-04', { isOffDay: false }], // Monday remains a workday.
    ['2027-01-05', { isOffDay: true }], // Outside the query.
  ])]]);
  assert.equal(countSnapshotWorkdays('2026-12-31', '2027-01-04', store), 3);
  assert.equal(countSnapshotWorkdays('2027-01-03', '2027-01-03', store), 1);
});

test('matches the daily reference for every verified year and each contiguous multi-year range', async () => {
  const data = await snapshots();
  for (const [region, store] of data) {
    const weekendDays = REGIONS[region].weekendDays;
    const years = [...store.keys()].sort((a, b) => a - b);
    const parity = (start, end) => assert.equal(
      countSnapshotWorkdays(start, end, store, weekendDays), countWorkdays(start, end, store, weekendDays),
      `${region} ${start} to ${end}`,
    );
    for (let i = 0; i < years.length; i++) {
      const year = years[i];
      parity(`${year}-01-01`, `${year}-12-31`);
      for (const date of store.get(year).keys()) parity(date, date);
      for (let j = i + 1; j < years.length && years[j] === years[j - 1] + 1; j++) {
        parity(`${year}-12-17`, `${years[j]}-01-15`);
      }
    }
  }
  assert.equal(countSnapshotWorkdays('2025-01-01', '2031-12-31', data.get('FR'), REGIONS.FR.weekendDays), 1762);
});
