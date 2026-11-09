// Vendor update check for vendor/lunar.js (6tail lunar-javascript).
// Run standalone (no deps):  node scripts/vendor-lunar-check.mjs
//
// Flow:
//   1. Compare vendored version (vendor/lunar.js header) with npm latest.
//   2. If newer exists:
//      a. Snapshot golden output (yi/ji/jieqi/lunar labels/festivals) for
//         every day of the current + next year (plus known edge dates),
//         using the CURRENT vendor.
//      b. Download the new minified build, rewrite vendor/lunar.js (with our
//         header), and snapshot again.
//      c. Report whether any consumed field changed.
//   3. Writes outputs for the GitHub workflow (see .github/workflows/).
//
// Exit contract for CI:
//   outputs.changed = false            → nothing to do
//   outputs.changed = true, drift=false → safe to auto-merge after tests pass
//   outputs.changed = true, drift=true  → PR must wait for a human decision

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor/lunar.js');

// Golden sample: EVERY day of [current year, next year] (the years users
// actually browse) plus known midnight-jieqi boundary days from far future —
// a table change in any consumed cell shows up instead of slipping through
// auto-merge. Yi/ji are pure lookups, so ~730 dates still run in milliseconds.
function enumerateYear(y) {
  const dates = [];
  const end = new Date(y + 1, 0, 1);
  for (let d = new Date(y, 0, 1); d < end; d.setDate(d.getDate() + 1)) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${d.getFullYear()}-${m}-${day}`);
  }
  return dates;
}
const GOLDEN_DATES = [
  ...enumerateYear(new Date().getFullYear()),
  ...enumerateYear(new Date().getFullYear() + 1),
  '2026-06-05',  // 芒种 23:48 — near-midnight jieqi boundary
  '2040-01-05',  // 小寒 next-day 02:03 — same class of edge
  '2040-10-07',  // 寒露 next-day 00:05 — 5 minutes from midnight
];

function readVendoredVersion() {
  const head = readFileSync(VENDOR, 'utf8').slice(0, 400);
  const m = head.match(/lunar-javascript v(\d+\.\d+\.\d+)/);
  if (!m) throw new Error('cannot find version in vendor/lunar.js header');
  return m[1];
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Snapshot every field lunar-adapter.js consumes, for the current vendor file.
// The adapter reads Solar/Lunar from the global scope at call time, so we can
// re-require the (replaced) vendor file and re-seed globals in one process.
async function goldenSnapshot() {
  const { createRequire } = await import('module');
  const req = createRequire(import.meta.url);
  if (req.cache) delete req.cache[VENDOR];
  const lunar = req(VENDOR);
  globalThis.Solar = lunar.Solar;
  globalThis.Lunar = lunar.Lunar;
  const adapterPath = path.join(ROOT, 'lunar-adapter.js');
  const { getDayInfo } = await import(adapterPath);
  return Object.fromEntries(GOLDEN_DATES.map((d) => [d, getDayInfo(d)]));
}

async function main() {
  const current = readVendoredVersion();
  const registry = JSON.parse(await fetchText('https://registry.npmjs.org/lunar-javascript/latest'));
  const latest = registry.version;

  const out = (k, v) => process.stdout.write(`${k}=${v}\n`);
  if (latest === current) {
    out('changed', 'false');
    console.log(`vendor/lunar.js is up-to-date at v${current}`);
    return;
  }

  console.log(`New version available: v${current} → v${latest}`);

  // Golden snapshot BEFORE the swap.
  const before = await goldenSnapshot();

  // Download the minified build served by jsDelivr (same pipeline that
  // produced the current vendor file: Terser on the npm build).
  const distUrl = `https://cdn.jsdelivr.net/npm/lunar-javascript@${latest}/lunar.min.js`;
  let code = await fetchText(distUrl);
  if (!code.includes('fromYmd')) {
    // Sanity: must be the UMD browser build defining Solar.
    throw new Error(`downloaded build looks wrong: ${distUrl}`);
  }
  const header = `/*
 * lunar-javascript v${latest} (https://github.com/6tail/lunar-javascript)
 * MIT License — Copyright (c) 6tail
 * Minified via jsDelivr (Terser) from the unminified npm build; see
 * lunar-adapter.js for the thin wrapper this project calls through.
 */
`;
  writeFileSync(VENDOR, header + code);

  // Golden snapshot AFTER the swap.
  const after = await goldenSnapshot();

  const diffs = [];
  for (const d of GOLDEN_DATES) {
    for (const k of Object.keys(before[d])) {
      if (JSON.stringify(before[d][k]) !== JSON.stringify(after[d][k])) {
        diffs.push(`${d}.${k}: ${JSON.stringify(before[d][k])} → ${JSON.stringify(after[d][k])}`);
      }
    }
  }

  out('changed', 'true');
  out('version', latest);
  out('drift', diffs.length > 0 ? 'true' : 'false');
  if (diffs.length) {
    console.log('GOLDEN DRIFT detected:');
    for (const line of diffs) console.log('  ' + line);
    writeFileSync(path.join(ROOT, 'vendor-drift.txt'),
      `lunar-javascript v${current} → v${latest}\n\n` +
      '以下字段在金标比对中发生变化(共 ' + diffs.length + ' 项):\n\n' +
      diffs.map((l) => '- ' + l).join('\n') + '\n');
  } else {
    console.log('Golden check clean: no change in consumed fields.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
