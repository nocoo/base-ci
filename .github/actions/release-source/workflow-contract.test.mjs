import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const workflow = readFileSync(join(root, '.github/workflows/deploy-worker.yml'), 'utf8');
const action = readFileSync(join(root, '.github/actions/release-source/action.yml'), 'utf8');
const selfTest = readFileSync(join(root, '.github/workflows/self-test-release.yml'), 'utf8');
const pin = workflow.match(/nocoo\/base-ci\/\.github\/actions\/release-source@([a-f0-9]{40})/)?.[1];

test('deploy-worker pins a full release-source SHA, not a relative composite path', () => {
  assert.match(pin ?? '', /^[a-f0-9]{40}$/);
  assert.doesNotMatch(workflow, /uses: \.\/\.github\/actions\/release-source/);
  assert.match(workflow, /persist-credentials: false/);
});

test('deploy-worker public secrets, lock and environment stay on the called job', () => {
  assert.match(workflow, /CLOUDFLARE_API_TOKEN:/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /environment:\n\s+name: \$\{\{ inputs\.environment \}\}/);
  assert.doesNotMatch(workflow, /secrets: inherit/);
  assert.doesNotMatch(workflow, /wrangler-action/);
  assert.doesNotMatch(workflow, /cancel-in-progress: true/);
  assert.doesNotMatch(workflow, /same-run-proof/);
});

test('deploy-worker pins verified Actions SHAs and requires an exact Wrangler version', () => {
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow, /nocoo\/base-ci\/\.github\/actions\/setup-js@1d6d6b1261661935fe2f1b385dcf822f0bf0a40a/);
  assert.match(workflow, /wrangler-version:[\s\S]*required: true/);
  assert.match(workflow, /parsed != expected/);
  assert.match(workflow, /os.path.abspath/);
  assert.match(workflow, /bash -euo pipefail -c/);
  assert.doesNotMatch(workflow, /bash -lc/);
  assert.doesNotMatch(workflow, /download-artifact/);
  assert.doesNotMatch(workflow, /artifact-mode/);
  assert.match(workflow, /deploy-script:/);
  assert.match(workflow, /install-policy:/);
});

test('release-source exposes run/tag/manual inputs and target-sha/source-run-id outputs', () => {
  for (const name of [
    'github-token',
    'expected-workflow-path',
    'expected-workflow-name',
    'expected-branch',
    'source-run-id',
    'tag',
    'source-sha',
    'require-fresh-main',
  ]) {
    assert.match(action, new RegExp(`^  ${name}:`, 'm'));
  }
  for (const name of ['target-sha', 'source-run-id']) {
    assert.match(action, new RegExp(`^  ${name}:`, 'm'));
  }
  assert.doesNotMatch(action, /^  same-run-proof:/m);
  assert.doesNotMatch(action, /^  caller-event-name:/m);
  assert.doesNotMatch(action, /^  source-ref:/m);
});

test('self-test-release runs helper tests and does not deploy', () => {
  assert.match(selfTest, /node --test \.github\/actions\/release-source\/resolve\.test\.mjs/);
  assert.match(selfTest, /node --test \.github\/actions\/release-source\/workflow-contract\.test\.mjs/);
  assert.doesNotMatch(selfTest, /deploy-worker\.yml@/);
  assert.doesNotMatch(selfTest, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets/);
});
