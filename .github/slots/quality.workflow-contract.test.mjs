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

function jobBlock(text, jobKey) {
  const start = text.indexOf(`\n  ${jobKey}:\n`);
  assert.ok(start >= 0, `Missing job: ${jobKey}`);
  const rest = text.slice(start + 1);
  const next = rest.search(/\n {2}[a-z0-9-]+:\n/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

test('quality.yml names every slot job by its slot number', () => {
  const expected = {
    'l1-gate': 'L1: Unit Tests & Coverage',
    's3-gate': 'S3: Workflow Lint',
    'g1-gate': 'G1: Secret Scan',
    'g2-gate': 'G2: Dependency Vulnerabilities',
    build: 'B1: Build',
    'l2-gate': 'L2: API E2E',
    'l3-gate': 'L3: Browser E2E',
    'worker-gate': 'L1.5: Worker Runtime Tests',
    'package-gate': 'P1: Package Check',
    'aggregate-gate': 'Z1: Gate',
  };
  for (const [jobKey, name] of Object.entries(expected)) {
    assert.match(jobBlock(quality, jobKey), new RegExp(`name: "${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
});

test('quality.yml drops the pre-slot job names', () => {
  for (const legacy of ['Quality Gate Aggregate', 'L1: Quality & Tests', 'G2: Security']) {
    assert.doesNotMatch(quality, new RegExp(`name: "${legacy}"`));
  }
  assert.doesNotMatch(quality, /name: "Build"\n/);
  assert.doesNotMatch(quality, /name: "Package Check"\n/);
  assert.doesNotMatch(quality, /name: "Worker Tests"\n/);
});

test('quality.yml exposes the slot-status and workflow-lint inputs', () => {
  assert.match(quality, /slot-status:\n\s+description:.*\n\s+type: string\n\s+default: ""/);
  assert.match(quality, /workflow-lint:\n\s+description:.*\n\s+type: boolean\n\s+default: false/);
  assert.match(quality, /workflow-lint-files:\n\s+description:.*\n\s+type: string\n\s+default: ""/);
  assert.match(quality, /workflow-lint-required-workflow:\n\s+description:.*\n\s+type: string\n\s+default: ""/);
  assert.match(quality, /workflow-lint-yamllint:\n\s+description:.*\n\s+type: boolean\n\s+default: false/);
});

test('quality.yml keeps the tested-sha and artifact-id output semantics', () => {
  assert.match(quality, /value: \$\{\{ jobs\.aggregate-gate\.outputs\.tested-sha \}\}/);
  assert.match(quality, /value: \$\{\{ jobs\.build\.outputs\.artifact-id \}\}/);
});

test('quality.yml exposes the S1/S2/L1 step outcomes for the Z1 gate', () => {
  const block = jobBlock(quality, 'l1-gate');
  assert.match(block, /name: "S1: Typecheck"\n\s+id: s1-typecheck/);
  assert.match(block, /name: "S2: Lint"\n\s+id: s2-lint/);
  assert.match(block, /name: "L1: Unit Tests & Coverage"\n\s+id: l1-unit/);
  assert.match(block, /s1-typecheck: \$\{\{ steps\.s1-typecheck\.outcome \}\}/);
  assert.match(block, /s2-lint: \$\{\{ steps\.s2-lint\.outcome \}\}/);
  assert.match(block, /l1-unit: \$\{\{ steps\.l1-unit\.outcome \}\}/);
});

test('quality.yml splits G1 and G2 into separate top-level jobs', () => {
  const g1 = jobBlock(quality, 'g1-gate');
  const g2 = jobBlock(quality, 'g2-gate');
  assert.match(g1, /uses: \.\/\.github\/workflows\/security\.yml/);
  assert.match(g2, /uses: \.\/\.github\/workflows\/security\.yml/);
  assert.match(g1, /scan-secrets: true\n\s+scan-dependencies: false/);
  assert.match(g2, /scan-secrets: false\n\s+scan-dependencies: true/);
  assert.match(g1, /security-command: \$\{\{ inputs\.security-command \}\}/);
  assert.match(g2, /security-command: ''/);
});

test('quality.yml calls the S3 workflow lint slot', () => {
  const block = jobBlock(quality, 's3-gate');
  assert.match(block, /if: inputs\.workflow-lint/);
  assert.match(block, /uses: \.\/\.github\/workflows\/workflow-lint\.yml/);
  assert.match(block, /files: \$\{\{ inputs\.workflow-lint-files \}\}/);
  assert.match(block, /required-reusable-workflow: \$\{\{ inputs\.workflow-lint-required-workflow \}\}/);
});

test('quality.yml Z1 gate needs every slot job and validates the declarations', () => {
  const block = jobBlock(quality, 'aggregate-gate');
  assert.match(block, /needs: \[l1-gate, s3-gate, g1-gate, g2-gate, build, l2-gate, l3-gate, worker-gate, package-gate\]/);
  assert.match(block, /if: always\(\)/);
  assert.match(block, /SLOT_STATUS: \$\{\{ inputs\.slot-status \}\}/);
  assert.match(block, /SLOT_S1_OUTCOME: \$\{\{ needs\.l1-gate\.outputs\.s1-typecheck \}\}/);
  assert.match(block, /SLOT_S3_OUTCOME: \$\{\{ needs\.s3-gate\.result \}\}/);
  assert.match(block, /SLOT_G1_OUTCOME: \$\{\{ needs\.g1-gate\.result \}\}/);
  assert.match(block, /SLOT_G2_OUTCOME: \$\{\{ needs\.g2-gate\.result \}\}/);
  assert.match(block, /SLOT_L15_OUTCOME: \$\{\{ needs\.worker-gate\.result \}\}/);
  assert.match(block, /SLOT_P1_OUTCOME: \$\{\{ needs\.package-gate\.result \}\}/);
  assert.match(block, /# SLOT_GATE_PYTHON_BEGIN/);
  assert.match(block, /# SLOT_GATE_PYTHON_END/);
  assert.match(block, /tested-sha=\{first_sha\}/);
});

test('security.yml keeps G1 and G2 distinguishable and preserves its outputs', () => {
  assert.match(security, /name: "G1: Gitleaks Secret Scan"/);
  assert.match(security, /name: "G2: OSV Dependency Scan"/);
  assert.match(security, /G1 \+ G2: Security Scan/);
  assert.match(security, /value: \$\{\{ jobs\.security\.outputs\.job-status \}\}/);
  assert.match(security, /value: \$\{\{ jobs\.security\.outputs\.tested-sha \}\}/);
});

test('workflow-lint.yml is the S3 slot and reports the tested SHA', () => {
  assert.match(workflowLint, /name: "S3: Workflow Lint"/);
  assert.match(workflowLint, /value: \$\{\{ jobs\.lint\.outputs\.tested-sha \}\}/);
  assert.match(workflowLint, /tested-sha: \$\{\{ steps\.step-result\.outputs\.sha \}\}/);
});

test('test-job.yml accepts a slot label without changing the default job name', () => {
  assert.match(testJob, /slot-label:\n\s+description:.*\n\s+type: string\n\s+default: ""/);
  assert.match(testJob, /inputs\.slot-label != '' && format\(/);
  assert.match(testJob, /\|\| format\('Test \(\{0\} on \{1\}\)'/);
});

test('quality.yml declares every slot state the Z1 gate reads', () => {
  const block = jobBlock(quality, 'aggregate-gate');
  const gate = quality.slice(quality.indexOf('# SLOT_GATE_PYTHON_BEGIN'), quality.indexOf('# SLOT_GATE_PYTHON_END'));
  const stateKeys = ['S1', 'S2', 'L1', 'S3', 'G1', 'G2', 'B1', 'L15', 'L2', 'L3', 'P1'];
  const jobKeys = ['S3', 'G1', 'G2', 'B1', 'L15', 'L2', 'L3', 'P1'];
  for (const key of stateKeys) {
    assert.match(block, new RegExp(`SLOT_${key}_ENABLED:`), `Missing SLOT_${key}_ENABLED`);
    assert.match(block, new RegExp(`SLOT_${key}_OUTCOME:`), `Missing SLOT_${key}_OUTCOME`);
  }
  for (const key of jobKeys) {
    assert.match(block, new RegExp(`SLOT_${key}_SHA:`), `Missing SLOT_${key}_SHA`);
  }
  assert.match(block, /SLOT_HOST_RESULT:/);
  assert.match(block, /SLOT_HOST_SHA:/);
  assert.match(gate, /SLOT_\{key\}_ENABLED/);
  assert.match(gate, /SLOT_\{key\}_OUTCOME/);
  assert.match(gate, /SLOT_\{key\}_SHA/);
  for (const slot of ['S1', 'S2', 'S3', 'G1', 'G2', 'B1', 'L1', 'L1.5', 'L2', 'L3', 'P1', 'Z1']) {
    assert.match(gate, new RegExp(`"${slot.replace('.', '\\.')}"`), `The gate does not know slot ${slot}`);
  }
  assert.match(gate, /"L1\.5": "L15"/);
});

test('self-test-quality.yml keeps a legacy and a strict slot path', () => {
  const selfTest = readFileSync(join(root, '.github/workflows/self-test-quality.yml'), 'utf8');
  const legacy = jobBlock(selfTest, 'test-quality-basic');
  const strict = jobBlock(selfTest, 'test-quality-strict-slots');
  assert.doesNotMatch(legacy, /slot-status:/);
  assert.match(strict, /needs: test-quality-basic/);
  assert.match(strict, /slot-status: >-/);
  assert.match(strict, /security: true/);
  assert.match(strict, /workflow-lint: true/);
  assert.match(strict, /typecheck: false/);
  assert.match(strict, /coverage-artifact-name: coverage-report-strict-slots/);
});

test('bun-quality.yml keeps the legacy job names', () => {
  assert.match(bunQuality, /name: "Worker Tests"/);
  assert.doesNotMatch(bunQuality, /slot-status:/);
});
