// Data layer: fetch holiday-cn JSON via jsDelivr CDN, cache in localStorage,
// expose an in-memory dataStore consumed by workday.js.

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master';
const TTL_MS = 7 * 24 * 3600 * 1000;
const cacheKey = (year) => `holiday-cn:${year}`;

const dataStore = new Map(); // Map<year, Map<dateStr, {name, isOffDay}>>

export function getDataStore() {
  return dataStore;
}

export function hasYear(year) {
  return dataStore.has(year);
}

function readCache(year) {
  try {
    const raw = localStorage.getItem(cacheKey(year));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(year, days) {
  try {
    localStorage.setItem(
      cacheKey(year),
      JSON.stringify({ days, fetchedAt: Date.now() })
    );
  } catch {
    // localStorage unavailable (private mode, quota). Silent skip.
  }
}

function ingest(year, days) {
  const map = new Map();
  for (const d of days) {
    map.set(d.date, { name: d.name, isOffDay: d.isOffDay });
  }
  dataStore.set(year, map);
}

async function fetchYear(year) {
  const res = await fetch(`${CDN_BASE}/${year}.json`);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return json.days || [];
}

// Load one year: cache (if fresh) → network → stale cache fallback.
// Returns {year, source: 'cache'|'cdn'|'stale-cache', error?}
async function loadOneYear(year) {
  const cached = readCache(year);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    ingest(year, cached.days);
    return { year, source: 'cache' };
  }
  try {
    const days = await fetchYear(year);
    ingest(year, days);
    writeCache(year, days);
    return { year, source: 'cdn' };
  } catch (error) {
    if (cached) {
      ingest(year, cached.days);
      return { year, source: 'stale-cache', error };
    }
    return { year, source: 'failed', error };
  }
}

// Load multiple years concurrently. Returns array of results.
export async function loadYears(years) {
  const unique = [...new Set(years)];
  return Promise.all(unique.map(loadOneYear));
}
