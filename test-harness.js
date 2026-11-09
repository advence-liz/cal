// Minimal browser-based test harness shared by *.test.js files. No deps.

export function makeRunner() {
  const results = [];
  function check(name, fn) {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, err: err.message });
    }
  }
  // Async variant: the promise's result lands in `results` when it settles,
  // so callers of runTests() must await it (tests.html does for async suites).
  async function checkAsync(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, err: err.message });
    }
  }
  function eq(actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`expected ${e}, got ${a}`);
  }
  function throws(fn) {
    let threw = false;
    try { fn(); } catch { threw = true; }
    if (!threw) throw new Error('expected to throw');
  }
  return { results, check, checkAsync, eq, throws };
}
