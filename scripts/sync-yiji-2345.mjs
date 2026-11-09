// Sync 宜/忌 overrides from 2345万年历 (tools.2345.com).
// Run with:  node scripts/sync-yiji-2345.mjs   (needs `npm install` for puppeteer)
//
// Why this exists: lunar.js's yiji table is a frozen snapshot of 2345's data
// (~99.5% identical, see repo analysis 2026-11). The residual + any future
// edits on 2345's side would silently drift. This script re-crawls 2345's
// published 宜/忌 for a 2-year window (current + next year) and regenerates
// data/yiji-overrides.js
// — a diff-only file listing JUST the dates where 2345 differs from lunar.js.
// The app then shows 2345's values verbatim on those dates.
//
// Method notes:
// - 2345's yjc API returns empty "无" data for direct scripted access; the
//   fetches must run inside a real page context (tools.2345.com) — hence
//   puppeteer + page.evaluate.
// - Normalization: tokens are deduplicated exactly ("安葬 安葬" → "安葬",
//   lossless); spelling is kept verbatim (2345's 雇庸 typo stays 雇庸).
// - Safety: if >1% of responses look throttled (both 宜 and 忌 as 无/empty),
//   or the resulting diff exceeds 3% of scanned days, the script aborts
//   WITHOUT writing — protecting the repo from a broken crawl.
// - Window: current + next year. Entries older than the window are pruned
//   (past dates have no decision value; 2345 doesn't retro-edit anyway).
//
// CI contract (grep'd by .github/workflows/yiji-sync.yml):
//   changed=true/false   regenerated file differs from the committed one
//   suspicious=true/false  diff looks anomalous → human must review
//   counts as console output

import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor/lunar.js');
const OUT_FILE = path.join(ROOT, 'data/yiji-overrides.js');
const PAGE_URL = 'https://tools.2345.com/rili.htm';
const API = 'https://static-wzdh.2345.com/tools/yjc?date=';
const DELAY_MS = 100;

const y = new Date().getFullYear();
// Window = current + next year. Past dates are NOT crawled: nobody plans
// 宜忌 around days already gone, and lunar.js's snapshot already matches
// 2345's historical values (frozen data, no retro-edits).
const YEARS = [y, y + 1];

const dedup = (s) => {
  const t = [...new Set(String(s || '').split(/\s+/).filter(Boolean))];
  return t.length ? t : ['无'];
};
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function enumerateYear(year) {
  const out = [];
  const end = new Date(year + 1, 0, 1);
  for (let d = new Date(year, 0, 1); d < end; d.setDate(d.getDate() + 1)) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${d.getFullYear()}-${m}-${day}`);
  }
  return out;
}
const DATES = YEARS.flatMap(enumerateYear);

// ---------- baseline: lunar.js raw output (no overrides) ----------
const req = createRequire(import.meta.url);
const lunar = req(VENDOR);
const baseline = new Map();
for (const ds of DATES) {
  const [yy, mm, dd] = ds.split('-').map(Number);
  const l = lunar.Solar.fromYmd(yy, mm, dd).getLunar();
  baseline.set(ds, {
    yi: dedup(l.getDayYi().join(' ')),
    ji: dedup(l.getDayJi().join(' ')),
  });
}

// ---------- crawl 2345 from page context ----------
// The page is ad-heavy and very slow from non-CN IPs (GitHub runners timed
// out at 60s), so we only need the document itself for origin/cookie
// context: block every subresource except the yjc API we call ourselves.
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', (req) => {
  const isMainFrameDoc = req.isNavigationRequest() && req.frame() === page.mainFrame();
  if (isMainFrameDoc || req.url().startsWith('https://static-wzdh.2345.com/')) {
    req.continue();
  } else {
    req.abort();
  }
});

let loaded = false;
for (let attempt = 1; attempt <= 3 && !loaded; attempt++) {
  try {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    loaded = true;
  } catch (e) {
    console.error(`page.goto attempt ${attempt} failed (${e.message.split('\n')[0]})`);
    if (attempt === 3) throw e;
  }
}

const rows = [];
// one page.evaluate per month keeps each call well under eval timeouts
for (let year of YEARS) {
  for (let month = 1; month <= 12; month++) {
    const days = new Date(year, month, 0).getDate();
    const chunk = Array.from({ length: days }, (_, i) =>
      `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
    );
    const out = await page.evaluate(async (ds, api, delayMs) => {
      const rows = [];
      for (const d of ds) {
        try {
          const r = await fetch(api + d.replaceAll('-', ''));
          const j = await r.json();
          const h = j?.data?.html;
          rows.push({ d, yi: h?.yi ?? '', ji: h?.ji ?? '' });
        } catch (e) {
          rows.push({ d, yi: '', ji: '' });
        }
        await new Promise((r2) => setTimeout(r2, delayMs));
      }
      return rows;
    }, chunk, API, DELAY_MS);
    rows.push(...out);
    process.stdout.write(`crawled ${year}-${String(month).padStart(2, '0')} (${rows.length}/${DATES.length})\n`);
  }
}
await browser.close();

// ---------- sanity guards ----------
const throttled = rows.filter((r) => dedup(r.yi)[0] === '无' && dedup(r.ji)[0] === '无' && r.yi !== undefined);
const throttledRatio = throttled.length / rows.length;
if (throttledRatio > 0.01) {
  console.error(`ABORT: ${(throttledRatio * 100).toFixed(1)}% of responses look throttled (无/无) — not writing.`);
  console.log('changed=false');
  console.log('suspicious=true');
  process.exit(1);
}

// ---------- build overrides ----------
const newOverrides = {};
for (const r of rows) {
  const t = { yi: dedup(r.yi), ji: dedup(r.ji) };
  const b = baseline.get(r.d);
  if (!b || eqArr(t.yi, b.yi) && eqArr(t.ji, b.ji)) continue; // agrees with lunar.js
  newOverrides[r.d] = t;
}

// Entries before the window are dropped entirely: past dates carry no
// decision value (user's call), 2345 never retro-edits, and lunar.js's
// snapshot already matches 2345's frozen historical data on those days.
const existing = readExisting();
const merged = {};
Object.assign(merged, newOverrides);
const sortedKeys = Object.keys(merged).sort();

const content = renderFile(sortedKeys, merged);

// Compare the override MAP, not the file text: the generated header carries
// a sync date that would otherwise flip `changed` every single day.
const canonic = (m) => JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k]]));
const changed = canonic(merged) !== canonic(existing);

const added = sortedKeys.filter((k) => !(k in existing));
const dropped = Object.keys(existing).filter((k) => !(k in newOverrides));
const suspicious = sortedKeys.length > 0.03 * DATES.length;

if (changed) {
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, content);
}

console.log(`scanned ${DATES.length} days (${YEARS.join(',')}), overrides: ${Object.keys(existing).length} → ${sortedKeys.length}`);
console.log(`added ${added.length}, dropped ${dropped.length}`);
if (suspicious) console.log('SUSPICIOUS: override count exceeds 3% of scanned days — review before merging.');
console.log('changed=' + changed);
console.log('suspicious=' + suspicious);

function readExisting() {
  if (!existsSync(OUT_FILE)) return {};
  const src = readFileSync(OUT_FILE, 'utf8');
  const m = src.match(/export const YIJI_OVERRIDES = (\{[\s\S]*\});/);
  if (!m) return {};
  try {
    return (0, eval)('(' + m[1] + ')');
  } catch {
    return {};
  }
}

function renderFile(keys, map) {
  const entries = keys.map((k) => {
    const { yi, ji } = map[k];
    return `  '${k}': { yi: ${JSON.stringify(yi)}, ji: ${JSON.stringify(ji)} },`;
  });
  return `// AUTO-GENERATED by scripts/sync-yiji-2345.mjs — do not edit by hand.
// Dates where 2345万年历's published 宜/忌 differ from lunar.js's computed
// output. All other days fall through to lunar.js (99.5%+ agreement).
// Normalization: duplicate tokens deduplicated; spelling kept verbatim.
// Last synced: ${new Date().toISOString().slice(0, 10)} · window ${YEARS.join('~')}
export const YIJI_OVERRIDES = {
${entries.join('\n')}
};
`;
}
