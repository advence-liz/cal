// CI test runner: loads tests.html in headless Chromium (via puppeteer) and
// fails the build if any suite has a non-green summary line.
// The site itself stays build-free; this script + package.json exist only
// for CI, not for running the app.
import puppeteer from 'puppeteer';

const PORT = process.env.TEST_PORT || 8080;
const URL = `http://localhost:${PORT}/tests.html`;

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();

page.on('console', (msg) => console.log('[page]', msg.text()));
page.on('pageerror', (err) => console.error('[pageerror]', err.message));

await page.goto(URL, { waitUntil: 'networkidle0' });

const summaries = await page.$$eval(
  'h2[id^="summary-"]',
  (els) => els.map((e) => ({ text: e.textContent, ok: e.className === 'ok' }))
);

if (summaries.length === 0) {
  console.error('No test summaries found — did tests.html load correctly?');
  process.exit(1);
}

let allOk = true;
for (const s of summaries) {
  console.log(s.ok ? '✓' : '✗', s.text);
  if (!s.ok) allOk = false;
}

await browser.close();
process.exit(allOk ? 0 : 1);
