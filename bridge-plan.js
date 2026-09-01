// "拼假攻略" — browse upcoming public holidays and see, for each one, the
// most cost-effective way to bridge an adjacent work-gap with annual leave
// into one long consecutive break. Pure logic, no DOM.

import { addDays, parseDate } from './workday.js';

const MAX_HOPS = 4;
export const DEFAULT_HORIZON_DAYS = 400;

// Which calendar years does [fromDate, fromDate + horizonDays) actually
// touch? Used to fetch exactly the years the opportunity scan will read —
// no more (a stray "N+2 not published yet" banner for a year the scan never
// looks at is just noise) and no less.
export function yearsInRange(fromDate, horizonDays = DEFAULT_HORIZON_DAYS) {
  const startYear = Number(fromDate.slice(0, 4));
  const endYear = Number(addDays(fromDate, horizonDays - 1).slice(0, 4));
  const years = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);
  return years;
}


function dayInfo(dataStore, dateStr) {
  const year = Number(dateStr.slice(0, 4));
  const yearMap = dataStore.get(year);
  const meta = yearMap ? yearMap.get(dateStr) : undefined;
  if (meta) return { off: meta.isOffDay, name: meta.isOffDay ? meta.name : null };
  const dow = parseDate(dateStr).getDay();
  return { off: dow === 0 || dow === 6, name: null };
}

// Alternating off/workday runs covering [fromDate, fromDate + horizonDays).
function buildSegments(dataStore, fromDate, horizonDays) {
  const segments = [];
  let cursor = fromDate;
  let cur = null;
  for (let i = 0; i < horizonDays; i++) {
    const { off, name } = dayInfo(dataStore, cursor);
    if (cur && cur.off === off) {
      cur.dates.push(cursor);
      if (name) cur.names.add(name);
    } else {
      cur = { off, dates: [cursor], names: new Set(name ? [name] : []) };
      segments.push(cur);
    }
    cursor = addDays(cursor, 1);
  }
  return segments;
}

// Cumulative {cost, gain, touched} for hopping outward (direction ±1) from a
// holiday segment through alternating gap/off-segment pairs, up to MAX_HOPS.
// `touched` lists the segment indices consumed by that many hops.
function buildChain(segments, coreIdx, direction) {
  const options = [{ cost: 0, gain: 0, touched: [] }];
  let cost = 0;
  let gain = 0;
  const touched = [];
  let idx = coreIdx;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const gapIdx = idx + direction;
    const gap = segments[gapIdx];
    if (!gap || gap.off) break;
    const nextOffIdx = gapIdx + direction;
    const nextOff = segments[nextOffIdx];
    cost += gap.dates.length;
    gain += gap.dates.length + (nextOff ? nextOff.dates.length : 0);
    touched.push(gapIdx);
    if (nextOff) touched.push(nextOffIdx);
    options.push({ cost, gain, touched: [...touched] });
    if (!nextOff) break;
    idx = nextOffIdx;
  }
  return options;
}

// Every (cost, gain) combo reachable by combining a left-chain hop count with
// a right-chain hop count, reduced to the Pareto frontier: cost ascending,
// gain strictly increasing (drops combos a cheaper option already beats).
function paretoOptions(segments, coreIdx) {
  const leftOpts = buildChain(segments, coreIdx, -1);
  const rightOpts = buildChain(segments, coreIdx, 1);
  const all = [];
  for (const l of leftOpts) {
    for (const r of rightOpts) {
      all.push({ cost: l.cost + r.cost, gain: l.gain + r.gain, leftTouched: l.touched, rightTouched: r.touched });
    }
  }
  all.sort((a, b) => a.cost - b.cost || b.gain - a.gain);
  const pareto = [];
  let bestGain = -1;
  for (const opt of all) {
    if (opt.gain > bestGain) {
      pareto.push(opt);
      bestGain = opt.gain;
    }
  }
  return pareto; // first entry is always {cost: 0, gain: 0} — the natural, unpaid block.
}

function daysBetweenInclusive(start, end) {
  return Math.round((parseDate(end) - parseDate(start)) / 86400000) + 1;
}

function reconstructPlan(segments, coreIdx, option) {
  const allIdx = [...option.leftTouched, coreIdx, ...option.rightTouched].sort((a, b) => a - b);
  const start = segments[allIdx[0]].dates[0];
  const endSeg = segments[allIdx[allIdx.length - 1]];
  const end = endSeg.dates[endSeg.dates.length - 1];

  const leaveDates = [];
  for (const i of [...option.leftTouched, ...option.rightTouched]) {
    if (!segments[i].off) leaveDates.push(...segments[i].dates);
  }
  leaveDates.sort();

  const names = new Set();
  for (const i of allIdx) {
    if (segments[i].off) for (const n of segments[i].names) names.add(n);
  }

  return {
    start,
    end,
    totalDays: daysBetweenInclusive(start, end),
    cost: option.cost,
    leaveDates,
    names: [...names],
  };
}

// One row per upcoming holiday: what you get for free, and — capped at
// maxLeaveDays if given — the single most cost-effective (days-off per
// leave-day) paid upgrade, if any exists within that cap.
// Holidays reached by bridging from either side collapse into one row keyed
// by the resulting date range (bridging from 中秋 into 国庆 and bridging from
// 国庆 into 中秋 land on the same block).
export function suggestHolidayOpportunities(dataStore, { fromDate, horizonDays = DEFAULT_HORIZON_DAYS, maxLeaveDays = Infinity } = {}) {
  const segments = buildSegments(dataStore, fromDate, horizonDays);
  const coreIdxs = [];
  segments.forEach((seg, i) => { if (seg.off && seg.names.size > 0) coreIdxs.push(i); });

  const cap = maxLeaveDays > 0 ? maxLeaveDays : 0;
  const byKey = new Map();

  for (const coreIdx of coreIdxs) {
    const pareto = paretoOptions(segments, coreIdx);
    const natural = reconstructPlan(segments, coreIdx, pareto[0]);

    const affordable = pareto.filter((o) => o.cost > 0 && o.cost <= cap);
    const recommended = affordable.length === 0
      ? null
      : reconstructPlan(segments, coreIdx, affordable.reduce((best, o) =>
          (o.gain / o.cost > best.gain / best.cost ? o : best)));

    const key = recommended ? `${recommended.start}_${recommended.end}` : `${natural.start}_${natural.end}`;
    const existing = byKey.get(key);
    if (!existing || natural.totalDays > existing.naturalDays) {
      byKey.set(key, {
        naturalStart: natural.start,
        naturalEnd: natural.end,
        naturalDays: natural.totalDays,
        naturalNames: natural.names,
        recommended,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const aStart = a.recommended ? a.recommended.start : a.naturalStart;
    const bStart = b.recommended ? b.recommended.start : b.naturalStart;
    return aStart.localeCompare(bStart);
  });
}
