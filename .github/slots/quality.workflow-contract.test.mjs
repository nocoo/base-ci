import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const quality = readFileSync(join(root, '.github/workflows/quality.yml'), 'utf8');
const security = readFileSync(join(root, '.github/workflows/security.yml'), 'utf8');
const workflowLint = readFileSync(join(root, '.github/workflows/workflow-lint.yml'), 'utf8');
const testJob = readFileSync(join(root, '.github/workflows/test-job.yml'), 'utf8');
const bunQuality = readFileSync(join(root, '.github/workflows/bun-quality.yml'), 'utf8');

const CANONICAL_JOBS = {
  's1-typecheck': 'S1: Types',
  's2-lint': 'S2: Lint',
  's3-workflow-lint': 'S3: Workflow',
  'g1-secret-scan': 'G1: Secrets',
  'g2-dependency-vulnerabilities': 'G2: Dependencies',
  'b1-build': 'B1: Build',
  'l1-unit-tests': 'L1: Unit',
  'l2-runtime': 'L2: Runtime',
  'l3-integration': 'L3: Integration',
  'l4-e2e': 'L4: E2E',
  'p1-package-check': 'P1: Package',
  'z1-gate': 'Z1: Gate',
};

function jobBlock(text, jobKey) {
  const start = text.indexOf(`\n  ${jobKey}:\n`);
  assert.ok(start >= 0, `Missing job: ${jobKey}`);
  const rest = text.slice(start + 1);
  const next = rest.search(/\n {2}[a-z0-9-]+:\n/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

test('quality.yml names every slot job by its canonical slot name', () => {
  for (const [jobKey, name] of Object.entries(CANONICAL_JOBS)) {
    assert.match(jobBlock(quality, jobKey), new RegExp(`name: "${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
});

test('quality.yml never calls another reusable workflow', () => {
  for (const nested of ['security.yml', 'workflow-lint.yml', 'test-job.yml']) {
    assert.doesNotMatch(quality, new RegExp(`uses: \\./\\.github/workflows/${nested.replace('.', '\\.')}`));
  }
});

test('quality.yml wires L2/L3/L4 through canonical inputs and deprecated aliases', () => {
  assert.match(jobBlock(quality, 'l2-runtime'), /if: inputs\.worker \|\| inputs\.l2-runtime/);
  assert.match(jobBlock(quality, 'l3-integration'), /if: inputs\.l2 \|\| inputs\.l3-integration/);
  const block = jobBlock(quality, 'l4-e2e');
  assert.match(block, /if: inputs\.l3 \|\| inputs\.l4/);
  assert.match(block, /inputs\.l4-browsers/);
  assert.match(block, /playwright install --with-deps/);
});

test('quality.yml Z1 gate needs every System0 slot job and validates declarations', () => {
  const block = jobBlock(quality, 'z1-gate');
  assert.match(
    block,
    /needs: \[s1-typecheck, s2-lint, s3-workflow-lint, g1-secret-scan, g2-dependency-vulnerabilities, b1-build, l1-unit-tests, l2-runtime, l3-integration, l4-e2e, p1-package-check\]/,
  );
  assert.match(block, /SLOT_L4_ENABLED:/);
  assert.match(block, /SLOT_L2_ENABLED: \$\{\{ inputs\.worker \|\| inputs\.l2-runtime \}\}/);
  assert.match(block, /verify_input_aliases/);
  assert.match(block, /# SLOT_GATE_PYTHON_BEGIN/);
  const gate = quality.slice(quality.indexOf('# SLOT_GATE_PYTHON_BEGIN'), quality.indexOf('# SLOT_GATE_PYTHON_END'));
  for (const slot of ['S1', 'S2', 'S3', 'G1', 'G2', 'B1', 'L1', 'L2', 'L3', 'L4', 'P1', 'Z1']) {
    assert.match(gate, new RegExp(`"${slot}"`), `The gate does not know slot ${slot}`);
  }
  assert.match(gate, /DEPRECATED_SLOT_KEYS/);
});

test('self-test-quality.yml keeps legacy and strict slot paths', () => {
  const selfTest = readFileSync(join(root, '.github/workflows/self-test-quality.yml'), 'utf8');
  const legacy = jobBlock(selfTest, 'test-quality-basic');
  const strict = jobBlock(selfTest, 'test-quality-strict-slots');
  assert.doesNotMatch(legacy, /slot-status:/);
  assert.match(strict, /"L4":/);
  assert.doesNotMatch(strict, /L1\.5/);
});

test('bun-quality.yml keeps the legacy job names', () => {
  assert.match(bunQuality, /name: "Worker Tests"/);
});
