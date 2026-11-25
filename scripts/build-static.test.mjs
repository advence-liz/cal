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
    for (const path of ['index.html', 'guide.html', 'guide.js', 'app.js', 'styles.css', 'manifest.json', 'service-worker.js', 'vendor/lunar.js']) {
      assert.ok((await stat(join(dest, path))).isFile(), path);
    }
    const home = await readFile(join(dest, 'index.html'), 'utf8');
    assert.match(home, /href="guide\.html"[^>]*data-i18n="guideLink"/);
    const guide = await readFile(join(dest, 'guide.html'), 'utf8');
    assert.match(guide, /href="\.\/"/);
    assert.match(guide, /id="site"/);
    assert.match(guide, /id="mcp"/);
    assert.match(home, /data-region="SA"[^>]*>沙特阿拉伯（金融业）<\/button>/);
    const docs = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    for (const text of [docs, guide]) assert.match(text, /按沙特阿拉伯金融业的假期安排，2026 年 9 月 24 日到 27 日有几个工作日/);
    const mcpUrls = text => [...new Set(text.match(/https:\/\/[^/\s`"<]+\/mcp\b/g) ?? [])];
    const renderMcp = 'https://moyu-calendar-mcp.onrender.com/mcp';
    assert.deepEqual(mcpUrls(docs), [renderMcp], 'README must advertise only the Render MCP endpoint');
    assert.deepEqual(mcpUrls(guide), [renderMcp], 'Guide must advertise only the Render MCP endpoint');
    assert.ok(guide.includes(`<code id="primaryMcp">${renderMcp}</code>`), 'The copy button must target the Render endpoint');
    const shell = await readFile(join(dest, 'service-worker.js'), 'utf8');
    assert.ok(shell.includes("'./guide.html'") && shell.includes("'./guide.js'"), 'Guide must be available offline');
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
