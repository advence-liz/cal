// Data layer: holiday-cn JSON. Local vendored copy first
// (data/holidays-YYYY.json, refreshed by holiday-vendor.yml), jsDelivr CDN as
// fallback; cache in localStorage; expose an in-memory dataStore consumed by
// workday.js. Local-first exists because cdn.jsdelivr.net is unreliable
// inside mainland China — vendoring makes the site zero-external-dependency.

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
    const cached = JSON.parse(raw);
    // Ignore empty caches (year placeholder cached before the schedule was published).
    return cached?.days?.length ? cached : null;
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

// Local file first (same-origin, fast in CN, offline-capable once the SW has
// cached it); jsDelivr only when the vendored file is missing — e.g. a brand
// new year not yet vendored. Returns { days, via: 'local' | 'cdn' }.
async function fetchYear(year) {
  try {
    const res = await fetch(`data/holidays-${year}.json`);
    if (res.ok) {
      const json = await res.json();
      const days = json.days || [];
      if (days.length > 0) return { days, via: 'local' };
    }
  } catch {
    // fall through to CDN
  }

  const res = await fetch(`${CDN_BASE}/${year}.json`);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const days = json.days || [];
  // Upstream publishes a placeholder file (days: []) before the State Council
  // announces the schedule; treat it the same as "not published yet".
  if (days.length === 0) {
    const err = new Error('schedule not published');
    err.status = 404;
    throw err;
  }
  return { days, via: 'cdn' };
}

// Load one year: cache (if fresh) → local vendored / network → stale cache fallback.
// Returns {year, source: 'cache'|'local'|'cdn'|'stale-cache', error?}
async function loadOneYear(year) {
  const cached = readCache(year);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    ingest(year, cached.days);
    return { year, source: 'cache' };
  }
  try {
    const { days, via } = await fetchYear(year);
    ingest(year, days);
    writeCache(year, days);
    return { year, source: via };
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
