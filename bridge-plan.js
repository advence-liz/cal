// "拼假攻略" — given a leave-day budget, find the short work-gaps next to
// public holidays worth bridging with annual leave to form one long
// consecutive break. Pure logic, no DOM.

import { addDays, parseDate } from './workday.js';

const MAX_HOPS = 4;

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

function bestComboForCore(segments, coreIdx, budget) {
  const leftOpts = buildChain(segments, coreIdx, -1);
  const rightOpts = buildChain(segments, coreIdx, 1);
  let best = null;
  for (const l of leftOpts) {
    for (const r of rightOpts) {
      const cost = l.cost + r.cost;
      if (cost > budget) continue;
      const gain = l.gain + r.gain;
      if (!best || gain > best.gain || (gain === best.gain && cost < best.cost)) {
        best = { cost, gain, leftTouched: l.touched, rightTouched: r.touched };
      }
    }
  }
  return best;
}

function daysBetweenInclusive(start, end) {
  return Math.round((parseDate(end) - parseDate(start)) / 86400000) + 1;
}

function reconstructPlan(segments, coreIdx, best) {
  const allIdx = [...best.leftTouched, coreIdx, ...best.rightTouched].sort((a, b) => a - b);
  const start = segments[allIdx[0]].dates[0];
  const endSeg = segments[allIdx[allIdx.length - 1]];
  const end = endSeg.dates[endSeg.dates.length - 1];

  const leaveDates = [];
  for (const i of [...best.leftTouched, ...best.rightTouched]) {
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
    cost: best.cost,
    leaveDates,
    names: [...names],
  };
}

// Returns plans sorted by resulting streak length (desc), deduped by exact
// date range — a holiday reached by bridging from either side is the same
// plan regardless of which named holiday "core" it was found from.
export function suggestLeavePlans(dataStore, { fromDate, budget, horizonDays = 400, maxResults = 8 }) {
  if (!(budget > 0)) return [];

  const segments = buildSegments(dataStore, fromDate, horizonDays);
  const coreIdxs = [];
  segments.forEach((seg, i) => { if (seg.off && seg.names.size > 0) coreIdxs.push(i); });

  const plansByKey = new Map();
  for (const coreIdx of coreIdxs) {
    const best = bestComboForCore(segments, coreIdx, budget);
    if (!best || best.cost === 0) continue; // nothing worth spending leave on here
    const plan = reconstructPlan(segments, coreIdx, best);
    const key = `${plan.start}_${plan.end}`;
    const existing = plansByKey.get(key);
    if (!existing || plan.cost < existing.cost) plansByKey.set(key, plan);
  }

  return [...plansByKey.values()]
    .sort((a, b) => b.totalDays - a.totalDays || a.cost - b.cost)
    .slice(0, maxResults);
}
