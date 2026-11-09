// Vendor holiday-cn JSON into the repo so the app stops depending on
// cdn.jsdelivr.net at runtime — jsDelivr is unreliable inside mainland China,
// and it was the site's only external runtime dependency.
//
// Fetches current + next year from the holiday-cn GitHub repo (via jsDelivr,
// which is fine from CI/dev machines outside CN) and writes
// data/holidays-YYYY.json — but ONLY when the content actually changed, so
// the daily/monthly run is a no-op almost all the time.
//
// Upstream publishes a placeholder (days: []) before the State Council
// announces a schedule; we never overwrite a populated local file with an
// empty one and never create empty files — the app treats "local file
// missing" as "fall back to CDN".
//
// CI contract (grep'd by .github/workflows/holiday-vendor.yml):
//   changed=true/false   any vendored file was added/updated
//   unpublished=YYYY,…   years whose upstream file is a placeholder

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data');
const BASE = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master';

const y = new Date().getFullYear();
// [y-1, y, y+1]: the calendar grid needs y-1 for the bleed cells when
// rendering January (app.js prefetches year-1/year/year+1). Missing y-1
// would still trigger a jsDelivr request every January.
const YEARS = [y - 1, y, y + 1];

const changedYears = [];
const unpublished = [];

for (const year of YEARS) {
  let json;
  try {
    const res = await fetch(`${BASE}/${year}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (e) {
    console.error(`ABORT: fetch ${year}.json failed (${e.message}) — not writing anything.`);
    console.log('changed=false');
    process.exit(1);
  }

  const days = json.days || [];
  if (days.length === 0) {
    unpublished.push(year);
    continue; // placeholder — leave any existing populated file untouched
  }

  // Canonical compare so upstream key reordering doesn't fake a change.
  const content = `${JSON.stringify(json, null, 2)}\n`;
  const file = path.join(OUT_DIR, `holidays-${year}.json`);
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const same = existing !== null &&
    JSON.stringify(JSON.parse(existing)) === JSON.stringify(json);
  if (!same) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(file, content);
    changedYears.push(year);
  }
}

console.log(`vendored years ${YEARS.join(',')}, changed: ${changedYears.join(',') || 'none'}` +
  (unpublished.length ? `, unpublished: ${unpublished.join(',')}` : ''));
console.log('changed=' + (changedYears.length > 0));
if (unpublished.length) console.log('unpublished=' + unpublished.join(','));
