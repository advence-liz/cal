import { loadYears, getDataStore } from './holidays.js';
import { makeRunner } from './test-harness.js';

// Integration-style suite: fetches real files over HTTP, so it needs the
// local test server (run-tests.mjs provides it). localStorage keys are
// cleared first so the 7-day TTL cache can't mask the load path under test.
export async function runTests() {
  const { results, check, checkAsync, eq } = makeRunner();

  check('0. 前置：清掉 localStorage 的 TTL 缓存', () => {
    for (const y of [2026, 2027, 2099]) localStorage.removeItem(`holiday-cn:${y}`);
  });

  await checkAsync('1. 本地 vendored 数据优先：2026 年来自同源文件', async () => {
    const [r] = await loadYears([2026]);
    eq(r.source, 'local');
    eq(r.error, undefined);
  });

  await checkAsync('2. vendored 数据内容正确：2026 元旦是休息日', async () => {
    const store = getDataStore().get(2026);
    eq(store.get('2026-01-01'), { name: '元旦', isOffDay: true });
  });

  await checkAsync('3. 本地 vendored 数据优先：2027 年也走同源文件', async () => {
    const [r] = await loadYears([2027]);
    eq(r.source, 'local');
    const store = getDataStore().get(2027);
    eq(store.get('2027-02-06'), { name: '春节', isOffDay: true });
  });

  await checkAsync('4. 兜底路径：本地缺失且上游未发布的年份 → failed，不假装有数据', async () => {
    const [r] = await loadYears([2099]);
    eq(r.source, 'failed');
    eq(getDataStore().has(2099), false);
  });

  await checkAsync('5. TTL 缓存命中：再次加载同一年直接用缓存（source=cache）', async () => {
    const [r] = await loadYears([2026]); // 前面已写过 fetchedAt=now 的缓存
    eq(r.source, 'cache');
  });

  return results;
}
