// Holiday schedules expose the same Map<year, Map<date, day>> for each region.
// CN keeps its existing local/CDN/cache chain; other regions use bundled snapshots.

export const DEFAULT_REGION = 'CN';
export const REGIONS = {
  CN: { source: 'https://github.com/NateScarlet/holiday-cn', label: 'NateScarlet/holiday-cn', scope: '国务院办公厅口径，含调休补班' },
  US: { source: 'https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/', label: '美国人事管理局（OPM）', scope: '全国联邦假期，按周一至周五排班的实际休假日；不含州假，私企以雇主安排为准', file: 'data/holidays-us.json' },
  SG: { source: 'https://www.mom.gov.sg/employment-practices/public-holidays', label: '新加坡人力部（MOM）', scope: '按周一至周五上班、周日为休息日计算；周六假日不自动补到周一', file: 'data/holidays-sg.json' },
  JP: { source: 'https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html', label: '日本内阁府', scope: '日本全国公众假期，含补休及夹在两个法定节日之间的国民休息日', file: 'data/holidays-jp.json' },
  GB: { source: 'https://www.gov.uk/bank-holidays', label: 'GOV.UK', scope: '仅英格兰和威尔士的银行假日，含补休；不含苏格兰和北爱尔兰', file: 'data/holidays-gb.json' },
  FR: { source: 'https://calendrier.api.gouv.fr/jours-feries/metropole.json', label: '法国政府公共假日数据', scope: '法国本土通用假日，不含地方和海外增补；实际排班以雇主安排为准', file: 'data/holidays-fr.json' },
  ZA: { source: 'https://www.gov.za/about-sa/public-holidays', label: '南非政府公共假日', scope: '全国公共假日，周日遇假时次日周一也放假', file: 'data/holidays-za.json' },
};

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master';
const TTL_MS = 7 * 24 * 3600 * 1000;
const cacheKey = (year) => `holiday-cn:${year}`;

const stores = new Map(Object.keys(REGIONS).map((region) => [region, new Map()]));
const pending = new Map();
const dataStore = stores.get(DEFAULT_REGION);

export function getDataStore(region = DEFAULT_REGION) {
  return stores.get(region);
}

export function hasYear(year, region = DEFAULT_REGION) {
  return getDataStore(region).has(year);
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

// Every date is indexed by the year in which the day off actually falls.
// An occurrence key still uses the original holiday's year for countdowns.
async function fetchRegion(region) {
  if (!pending.has(region)) {
    const request = (async () => {
      const res = await fetch(REGIONS[region].file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { years } = await res.json();
      const entries = Object.entries(years);
      if (!entries.length || entries.some(([, days]) => !Array.isArray(days) || !days.length)) {
        throw new Error('Invalid holiday snapshot');
      }
      const loaded = entries.map(([year, days]) => [Number(year), new Map(days.map(
        ([date, name, observedFor]) => [date, {
          name, isOffDay: true, holidayId: `${(observedFor || date).slice(0, 4)}:${name}`,
          ...(observedFor ? { observedFor } : {}),
        }]
      ))]);
      const store = getDataStore(region);
      for (const [year, days] of loaded) store.set(year, days);
    })().catch((error) => {
      pending.delete(region); // retry on the next request
      throw error;
    });
    pending.set(region, request);
  }
  return pending.get(region);
}

// Load multiple years, preserving the CN return statuses and legacy callers.
export async function loadYears(years, region = DEFAULT_REGION) {
  const unique = [...new Set(years)];
  if (region === DEFAULT_REGION) return Promise.all(unique.map(loadOneYear));
  if (!unique.length) return [];
  try {
    await fetchRegion(region);
    return unique.map((year) => ({ year, source: hasYear(year, region) ? 'local' : 'unavailable' }));
  } catch (error) {
    return unique.map((year) => ({ year, source: 'failed', error }));
  }
}
