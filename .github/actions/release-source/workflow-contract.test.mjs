import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const helperSha = 'e92dc06d79019c891cacf165d6bf7f234073c5f0';
const workflow = readFileSync(join(root, '.github/workflows/deploy-worker.yml'), 'utf8');
const action = readFileSync(join(root, '.github/actions/release-source/action.yml'), 'utf8');
const selfTest = readFileSync(join(root, '.github/workflows/self-test-release.yml'), 'utf8');

test('deploy-worker pins the immutable release-source SHA, not a relative composite path', () => {
  assert.match(
    workflow,
    new RegExp(
      `uses: nocoo/base-ci/\\.github/actions/release-source@${helperSha}`,
    ),
  );
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
});

test('deploy-worker pins verified Actions SHAs and requires an exact Wrangler version', () => {
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  assert.match(workflow, /oven-sh\/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6/);
  assert.match(workflow, /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/);
  assert.match(workflow, /wrangler-version:[\s\S]*required: true/);
  assert.match(workflow, /Locked local wrangler binary not found/);
});

test('release-source exposes the public proof inputs and outputs', () => {
  for (const name of [
    'github-token',
    'expected-workflow-path',
    'expected-workflow-name',
    'allowed-source-events',
    'source-run-id',
    'source-sha',
    'tag',
    'same-run-proof',
    'require-fresh-main',
    'package-version-match',
    'caller-event-name',
  ]) {
    assert.match(action, new RegExp(`^  ${name}:`, 'm'));
  }
  for (const name of ['target-sha', 'source-run-id', 'event-type', 'workflow-path', 'head-branch']) {
    assert.match(action, new RegExp(`^  ${name}:`, 'm'));
  }
});

test('self-test-release runs helper tests and does not deploy', () => {
  assert.match(selfTest, /node --test \.github\/actions\/release-source\/resolve\.test\.mjs/);
  assert.match(selfTest, /node --test \.github\/actions\/release-source\/workflow-contract\.test\.mjs/);
  assert.doesNotMatch(selfTest, /deploy-worker\.yml@/);
  assert.doesNotMatch(selfTest, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets/);
});
