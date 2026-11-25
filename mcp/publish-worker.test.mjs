import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deployIfChanged } from './publish-worker.mjs';

const revision = 'a'.repeat(40);
const version = '552bd080-d406-4ace-bf22-2b310355976c';
function fake(tag, versions = [{ version_id: version, percentage: 100 }]) {
  const calls = [];
  const run = (...args) => {
    calls.push(args);
    if (args[0] === 'deployments') return JSON.stringify([{ versions }]);
    if (args[0] === 'versions') return JSON.stringify({ annotations: { 'workers/tag': tag } });
    assert.equal(args[0], 'deploy');
    return 'uploaded';
  };
  return { calls, run };
}

test('an already deployed input revision does not create another Worker version', () => {
  const { calls, run } = fake(`cal-${revision}`);
  assert.deepEqual(deployIfChanged(revision, run), { deployed: false });
  assert.deepEqual(calls, [['deployments', 'list', '--json'], ['versions', 'view', version, '--json']]);
});

test('a new input revision is deployed once, without framework changes', () => {
  const { calls, run } = fake(undefined);
  assert.deepEqual(deployIfChanged(revision, run), { deployed: true, output: 'uploaded' });
  assert.deepEqual(calls.at(-1), ['deploy', '--strict', '--no-autoconfig', '--no-upload-source-maps', '--tag', `cal-${revision}`]);
});

test('invalid input or an unexpected active deployment fails closed', () => {
  const { calls, run } = fake(undefined, [{ version_id: version, percentage: 50 }]);
  assert.throws(() => deployIfChanged('not-a-git-revision', run), /Invalid deployment revision/);
  assert.equal(calls.length, 0);
  assert.throws(() => deployIfChanged(revision, run), /one active Worker version at 100%/);
  assert.ok(!calls.some(([command]) => command === 'deploy'));
});
