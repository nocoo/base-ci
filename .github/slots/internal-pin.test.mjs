import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const providerPin = readFileSync(join(root, '.github/internal-provider-pin.txt'), 'utf8').trim();
const minimumReleaseSourcePin = readFileSync(
  join(root, '.github/minimum-release-source-pin.txt'),
  'utf8',
).trim();

test('provider pin is a full git SHA', () => {
  assert.match(providerPin, /^[a-f0-9]{40}$/);
});

test('release-source at provider pin includes required-quality-check', () => {
  const action = readFileSync(join(root, '.github/actions/release-source/action.yml'), 'utf8');
  assert.match(action, /required-quality-check:/);
});

test('every nocoo/base-ci internal action reference matches provider pin', () => {
  const workflows = readdirSync(join(root, '.github/workflows')).filter((name) => name.endsWith('.yml'));
  const mismatches = [];
  const pattern = /nocoo\/base-ci\/\.github\/actions\/[a-z0-9-]+@([a-f0-9]{40})/g;
  for (const file of workflows) {
    const text = readFileSync(join(root, '.github/workflows', file), 'utf8');
    for (const match of text.matchAll(pattern)) {
      if (match[1] !== providerPin) {
        mismatches.push(`${file}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(mismatches, []);
});

test('provider pin is not older than minimum release-source pin', () => {
  assert.match(minimumReleaseSourcePin, /^[a-f0-9]{40}$/);
  assert.notEqual(providerPin, '2231caf82cf16f103f48cab467b3464b106d6604');
  assert.ok(
    BigInt(`0x${providerPin}`) >= BigInt(`0x${minimumReleaseSourcePin}`),
    'provider pin must be at least the minimum release-source pin',
  );
});

test('release-source pins are consistent across deploy workflows', () => {
  const pattern = /nocoo\/base-ci\/\.github\/actions\/release-source@([a-f0-9]{40})/g;
  const seen = new Set();
  for (const file of ['deploy-worker.yml', 'deploy-docker.yml']) {
    const text = readFileSync(join(root, '.github/workflows', file), 'utf8');
    for (const match of text.matchAll(pattern)) {
      seen.add(match[1]);
    }
  }
  assert.equal(seen.size, 1);
  assert.equal([...seen][0], providerPin);
});
