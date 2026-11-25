import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildStatic } from './build-static.mjs';

test('static output preserves the existing PWA without publishing backend code or tests', async () => {
  const dest = await mkdtemp(join(tmpdir(), 'moyu-static-'));
  try {
    await buildStatic(dest);
    for (const path of ['index.html', 'app.js', 'styles.css', 'manifest.json', 'service-worker.js', 'vendor/lunar.js']) {
      assert.ok((await stat(join(dest, path))).isFile(), path);
    }
    const shell = await readFile(join(dest, 'service-worker.js'), 'utf8');
    for (const [, path] of shell.matchAll(/'\.\/([^']+)'/g)) assert.ok((await stat(join(dest, path))).isFile(), path);
    for (const file of ['holidays-2027.json', 'holidays-au.json', 'holidays-sa.json']) {
      assert.ok((await stat(join(dest, 'data', file))).isFile(), file);
    }
    const files = await readdir(dest);
    for (const path of ['mcp', '.git', '.github', 'scripts', 'tests.html', 'package.json', 'workday.test.js']) {
      assert.ok(!files.includes(path), path);
    }
  } finally { await rm(dest, { recursive: true }); }
});
