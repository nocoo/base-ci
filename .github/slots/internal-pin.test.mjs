import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const providerPin = readFileSync(join(root, '.github/internal-provider-pin.txt'), 'utf8').trim().split(/\s+/)[0];
const minimumReleaseSourcePin = readFileSync(
  join(root, '.github/minimum-release-source-pin.txt'),
  'utf8',
).trim().split(/\s+/)[0];

const actionRefPattern = /nocoo\/base-ci\/\.github\/actions\/[a-z0-9-]+@([a-f0-9]{40})/g;

function commitReachableLocally(sha) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function assertCommitReachable(sha) {
  if (commitReachableLocally(sha)) {
    return;
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    execFileSync('gh', ['api', `repos/nocoo/base-ci/commits/${sha}`, '--silent'], {
      cwd: root,
      stdio: 'pipe',
      env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
    });
    return;
  }
  throw new Error(
    `pinned SHA ${sha} is not in the local object database; checkout with fetch-depth: 0 or set GITHUB_TOKEN for API verification`,
  );
}

function releaseSourceAtPin(sha) {
  if (commitReachableLocally(sha)) {
    return execFileSync('git', ['show', `${sha}:.github/actions/release-source/action.yml`], {
      cwd: root,
      encoding: 'utf8',
    });
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (sha === head) {
    return readFileSync(join(root, '.github/actions/release-source/action.yml'), 'utf8');
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  assert.ok(token, 'GITHUB_TOKEN required to read release-source at a non-HEAD provider pin');
  const encoded = execFileSync(
    'gh',
    [
      'api',
      `repos/nocoo/base-ci/contents/.github/actions/release-source/action.yml?ref=${sha}`,
      '--jq',
      '.content',
    ],
    { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token } },
  ).trim();
  return Buffer.from(encoded, 'base64').toString('utf8');
}

function collectPinnedShas() {
  const shas = new Set([providerPin]);
  const workflows = readdirSync(join(root, '.github/workflows')).filter((name) => name.endsWith('.yml'));
  for (const file of workflows) {
    const text = readFileSync(join(root, '.github/workflows', file), 'utf8');
    for (const match of text.matchAll(actionRefPattern)) {
      shas.add(match[1]);
    }
  }
  return [...shas];
}

test('provider pin is a full git SHA', () => {
  assert.match(providerPin, /^[a-f0-9]{40}$/);
});

test('every pinned SHA resolves in this repository', () => {
  for (const sha of collectPinnedShas()) {
    assertCommitReachable(sha);
  }
});

test('release-source at provider pin includes required-quality-check', () => {
  const action = releaseSourceAtPin(providerPin);
  assert.match(action, /required-quality-check:/);
});

test('every nocoo/base-ci internal action reference matches provider pin', () => {
  const workflows = readdirSync(join(root, '.github/workflows')).filter((name) => name.endsWith('.yml'));
  const mismatches = [];
  for (const file of workflows) {
    const text = readFileSync(join(root, '.github/workflows', file), 'utf8');
    for (const match of text.matchAll(actionRefPattern)) {
      if (match[1] !== providerPin) {
        mismatches.push(`${file}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(mismatches, []);
});

test('provider pin is not older than minimum release-source pin', () => {
  assert.match(minimumReleaseSourcePin, /^[a-f0-9]{40}$/);
  assertCommitReachable(minimumReleaseSourcePin);
  assert.notEqual(providerPin, '2231caf82cf16f103f48cab467b3464b106d6604');
  assert.notEqual(providerPin, 'e215ac8011b63561e0b6307dbff2d22d79ae5f47');
  assert.ok(
    BigInt(`0x${providerPin}`) >= BigInt(`0x${minimumReleaseSourcePin}`),
    'provider pin must be at least the minimum release-source pin',
  );
});

test('release-source pins are consistent across deploy workflows', () => {
  const seen = new Set();
  for (const file of ['deploy-worker.yml', 'deploy-docker.yml']) {
    const text = readFileSync(join(root, '.github/workflows', file), 'utf8');
    for (const match of text.matchAll(actionRefPattern)) {
      if (match[0].includes('release-source')) {
        seen.add(match[1]);
      }
    }
  }
  assert.equal(seen.size, 1);
  assert.equal([...seen][0], providerPin);
});
