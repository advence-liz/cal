import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function deployIfChanged(revision, wrangler) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid deployment revision');
  const tag = `cal-${revision}`;
  const current = JSON.parse(wrangler('deployments', 'status', '--json'));
  const versions = current?.versions ?? [];
  if (versions.length !== 1 || versions[0].percentage !== 100 || !versions[0].version_id) {
    throw new Error('Expected one active Worker version at 100%; refusing to replace the deployment');
  }
  const active = JSON.parse(wrangler('versions', 'view', versions[0].version_id, '--json'));
  if (active.annotations?.['workers/tag'] === tag) return { deployed: false };
  return { deployed: true, output: wrangler('deploy', '--strict', '--no-autoconfig', '--no-upload-source-maps', '--tag', tag) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const cwd = fileURLToPath(new URL('.', import.meta.url));
  const bin = fileURLToPath(new URL('./node_modules/.bin/wrangler', import.meta.url));
  const result = deployIfChanged(process.argv[2] ?? '', (...args) => execFileSync(bin, args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 120_000,
  }));
  console.log(result.deployed ? result.output.trimEnd() : 'Worker already serves this revision; no upload needed.');
}
