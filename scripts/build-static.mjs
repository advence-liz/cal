import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const shell = [
  'index.html', 'guide.html', 'guide.js', 'styles.css', 'app.js', 'i18n.js', 'region-clock.js', 'calendar.js',
  'workday.js', 'holidays.js', 'bridge-plan.js', 'lunar-adapter.js', 'almanac-info.js',
  'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'service-worker.js', 'sw-register.js',
  'vendor/lunar.js', 'vendor/LICENSE-lunar', 'data/yiji-overrides.js',
];

export async function buildStatic(dest = join(root, 'dist')) {
  const holidayFiles = (await readdir(join(root, 'data')))
    .filter(file => /^holidays-(?:\d{4}|[a-z]{2})\.json$/.test(file))
    .map(file => join('data', file));
  for (const path of [...shell, ...holidayFiles]) {
    const target = join(dest, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, path), target);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildStatic();
