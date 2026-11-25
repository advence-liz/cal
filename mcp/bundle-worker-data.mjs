import { readdir, writeFile } from 'node:fs/promises';

const files = (await readdir(new URL('../data/', import.meta.url)))
  .filter(file => /^holidays-(?:\d{4}|[a-z]{2})\.json$/.test(file)).sort();
const imports = files.map((file, i) => `import rows${i} from '../data/${file}';`);
const entries = files.map((file, i) => `  'data/${file}': rows${i},`);
await writeFile(new URL('./worker-snapshots.generated.mjs', import.meta.url), [
  '// Generated from repository snapshots; do not edit.', ...imports, 'export default {', ...entries, '};', '',
].join('\n'));
