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
  's1-typecheck': 'S1: Typecheck',
  's2-lint': 'S2: Lint',
  's3-workflow-lint': 'S3: Workflow Lint',
  'g1-secret-scan': 'G1: Secret Scan',
  'g2-dependency-vulnerabilities': 'G2: Dependency Vulnerabilities',
  'b1-build': 'B1: Build',
  'l1-unit-tests': 'L1: Unit Tests & Coverage',
  'l15-worker-runtime': 'L1.5: Worker Runtime Tests',
  'l2-api-e2e': 'L2: API E2E',
  'l3-browser-e2e': 'L3: Browser E2E',
  'p1-package-check': 'P1: Package Check',
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

test('every canonical slot name appears exactly once as a job name in quality.yml', () => {
  for (const name of Object.values(CANONICAL_JOBS)) {
    const occurrences = quality.split(new RegExp(`^ {4}name: "${name}"$`, 'm')).length - 1;
    assert.equal(occurrences, 1, `Canonical job name ${name} must appear exactly once`);
  }
});

test('quality.yml never calls another reusable workflow', () => {
  for (const nested of ['security.yml', 'workflow-lint.yml', 'test-job.yml']) {
    assert.doesNotMatch(quality, new RegExp(`uses: \\./\\.github/workflows/${nested.replace('.', '\\.')}`));
  }
  for (const block of Object.keys(CANONICAL_JOBS).map((key) => jobBlock(quality, key))) {
    assert.doesNotMatch(block, /uses: \.\/\.github\/workflows\//);
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
  assert.match(quality, /value: \$\{\{ jobs\.z1-gate\.outputs\.tested-sha \}\}/);
  assert.match(quality, /value: \$\{\{ jobs\.b1-build\.outputs\.artifact-id \}\}/);
});

test('quality.yml runs S1 and S2 as independent top-level jobs', () => {
  const s1 = jobBlock(quality, 's1-typecheck');
  const s2 = jobBlock(quality, 's2-lint');
  assert.match(s1, /name: "S1: Typecheck"/);
  assert.match(s1, /if: inputs\.typecheck/);
  assert.match(s1, /tested-sha: \$\{\{ steps\.record-sha\.outputs\.sha \}\}/);
  assert.match(s1, /inputs\.typecheck-command/);
  assert.match(s1, /uses: actions\/checkout@/);
  assert.match(s1, /uses: nocoo\/base-ci\/\.github\/actions\/setup-js@/);
  assert.match(s1, /uses: nocoo\/base-ci\/\.github\/actions\/configure-env@/);
  assert.match(s2, /name: "S2: Lint"/);
  assert.match(s2, /if: inputs\.lint/);
  assert.match(s2, /tested-sha: \$\{\{ steps\.record-sha\.outputs\.sha \}\}/);
  assert.match(s2, /inputs\.lint-command/);
  assert.doesNotMatch(s1, /inputs\.lint-command/);
  assert.doesNotMatch(s2, /inputs\.typecheck-command/);
});

test('quality.yml keeps L1 as a canonical job that exports the unit step outcome and its job status', () => {
  const block = jobBlock(quality, 'l1-unit-tests');
  assert.match(block, /name: "L1: Unit Tests & Coverage"/);
  assert.match(block, /l1-unit: \$\{\{ steps\.l1-unit\.outcome \}\}/);
  assert.match(block, /l1-job-status: \$\{\{ steps\.record-sha\.outputs\.status \}\}/);
  assert.match(block, /tested-sha: \$\{\{ steps\.record-sha\.outputs\.sha \}\}/);
  assert.match(block, /id: l1-unit\n\s+if: inputs\.unit/);
  assert.match(block, /echo "status=\$\{\{ job\.status \}\}"/);
  assert.doesNotMatch(block, /^ {4}if: inputs\.unit$/m);
});

test('quality.yml wires the L3 multi-browser, prepare and evidence inputs', () => {
  assert.match(quality, /l3-browsers:\n\s+description:.*\n\s+type: string\n\s+default: ""/);
  assert.match(quality, /l3-prepare-command:\n\s+description:.*\n\s+type: string\n\s+default: ""/);
  assert.match(quality, /l3-artifact-name:\n\s+description:.*\n\s+type: string\n\s+default: ""/);
  assert.match(quality, /l3-artifact-path:\n\s+description:.*\n\s+type: string\n\s+default: ""/);
  assert.match(quality, /l3-artifact-retention-days:\n\s+description:.*\n\s+type: number\n\s+default: 7/);

  const block = jobBlock(quality, 'l3-browser-e2e');
  assert.match(block, /IN_BROWSERS: \$\{\{ inputs\.l3-browsers != '' && inputs\.l3-browsers \|\| inputs\.l3-browser \}\}/);
  assert.match(block, /IN_PREPARE: \$\{\{ inputs\.l3-prepare-command != '' && inputs\.l3-prepare-command \|\| inputs\.prepare-command \}\}/);
  assert.match(block, /read -r -a BROWSERS <<< "\$IN_BROWSERS"/);
  assert.match(block, /playwright install --with-deps "\$\{BROWSERS\[@\]\}"/);
  assert.doesNotMatch(block, /playwright install --with-deps "\$IN_BROWSERS"/);
  assert.match(block, /if: always\(\) && inputs\.l3-artifact-name != '' && inputs\.l3-artifact-path != ''/);
  assert.match(block, /name: \$\{\{ inputs\.l3-artifact-name \}\}/);
  assert.match(block, /path: \$\{\{ inputs\.l3-artifact-path \}\}/);
  assert.match(block, /retention-days: \$\{\{ inputs\.l3-artifact-retention-days \}\}/);
});

test('quality.yml wires the L2 evidence inputs', () => {
  assert.match(quality, /l2-artifact-name:\n\s+description:.*\n\s+type: string\n\s+default: ""/);
  assert.match(quality, /l2-artifact-path:\n\s+description:.*\n\s+type: string\n\s+default: ""/);
  assert.match(quality, /l2-artifact-retention-days:\n\s+description:.*\n\s+type: number\n\s+default: 7/);

  const block = jobBlock(quality, 'l2-api-e2e');
  assert.match(block, /if: always\(\) && inputs\.l2-artifact-name != '' && inputs\.l2-artifact-path != ''/);
  assert.match(block, /name: \$\{\{ inputs\.l2-artifact-name \}\}/);
  assert.match(block, /path: \$\{\{ inputs\.l2-artifact-path \}\}/);
  assert.match(block, /retention-days: \$\{\{ inputs\.l2-artifact-retention-days \}\}/);
});

test('quality.yml inlines the S3, G1 and G2 slot logic', () => {
  const s3 = jobBlock(quality, 's3-workflow-lint');
  assert.match(s3, /if: inputs\.workflow-lint/);
  assert.match(s3, /actionlint_1\.7\.12_linux_amd64\.tar\.gz/);
  assert.match(s3, /WORKFLOW_FILES: \$\{\{ inputs\.workflow-lint-files \}\}/);
  assert.match(s3, /REQUIRED_WORKFLOW: \$\{\{ inputs\.workflow-lint-required-workflow \}\}/);
  assert.match(s3, /if: inputs\.workflow-lint-yamllint/);

  const g1 = jobBlock(quality, 'g1-secret-scan');
  assert.match(g1, /if: inputs\.security/);
  assert.match(g1, /gitleaks/);
  assert.match(g1, /IN_SEC_CMD: \$\{\{ inputs\.security-command \}\}/);

  const g2 = jobBlock(quality, 'g2-dependency-vulnerabilities');
  assert.match(g2, /if: inputs\.security/);
  assert.match(g2, /osv-scanner scan --lockfile="\$lf"/);
  assert.doesNotMatch(g2, /inputs\.security-command/);
});

test('quality.yml Z1 gate needs every slot job and validates the declarations', () => {
  const block = jobBlock(quality, 'z1-gate');
  assert.match(block, /needs: \[s1-typecheck, s2-lint, s3-workflow-lint, g1-secret-scan, g2-dependency-vulnerabilities, b1-build, l1-unit-tests, l15-worker-runtime, l2-api-e2e, l3-browser-e2e, p1-package-check\]/);
  assert.match(block, /if: always\(\)/);
  assert.match(block, /SLOT_STATUS: \$\{\{ inputs\.slot-status \}\}/);
  assert.match(block, /SLOT_S1_OUTCOME: \$\{\{ needs\.s1-typecheck\.result \}\}/);
  assert.match(block, /SLOT_S2_OUTCOME: \$\{\{ needs\.s2-lint\.result \}\}/);
  assert.match(block, /SLOT_L1_OUTCOME: \$\{\{ needs\.l1-unit-tests\.outputs\.l1-unit \}\}/);
  assert.match(block, /SLOT_L1_JOB_STATUS: \$\{\{ needs\.l1-unit-tests\.outputs\.l1-job-status \}\}/);
  assert.match(block, /SLOT_S3_OUTCOME: \$\{\{ needs\.s3-workflow-lint\.result \}\}/);
  assert.match(block, /SLOT_G1_OUTCOME: \$\{\{ needs\.g1-secret-scan\.result \}\}/);
  assert.match(block, /SLOT_G2_OUTCOME: \$\{\{ needs\.g2-dependency-vulnerabilities\.result \}\}/);
  assert.match(block, /SLOT_L15_OUTCOME: \$\{\{ needs\.l15-worker-runtime\.result \}\}/);
  assert.match(block, /SLOT_L2_OUTCOME: \$\{\{ needs\.l2-api-e2e\.result \}\}/);
  assert.match(block, /SLOT_L3_OUTCOME: \$\{\{ needs\.l3-browser-e2e\.result \}\}/);
  assert.match(block, /SLOT_P1_OUTCOME: \$\{\{ needs\.p1-package-check\.result \}\}/);
  assert.match(block, /# SLOT_GATE_PYTHON_BEGIN/);
  assert.match(block, /# SLOT_GATE_PYTHON_END/);
  assert.match(block, /tested-sha=\{first_sha\}/);
});

test('quality.yml declares every slot state the Z1 gate reads', () => {
  const block = jobBlock(quality, 'z1-gate');
  const gate = quality.slice(quality.indexOf('# SLOT_GATE_PYTHON_BEGIN'), quality.indexOf('# SLOT_GATE_PYTHON_END'));
  const stateKeys = ['S1', 'S2', 'L1', 'S3', 'G1', 'G2', 'B1', 'L15', 'L2', 'L3', 'P1'];
  for (const key of stateKeys) {
    assert.match(block, new RegExp(`SLOT_${key}_ENABLED:`), `Missing SLOT_${key}_ENABLED`);
    assert.match(block, new RegExp(`SLOT_${key}_OUTCOME:`), `Missing SLOT_${key}_OUTCOME`);
    assert.match(block, new RegExp(`SLOT_${key}_SHA:`), `Missing SLOT_${key}_SHA`);
  }
  assert.match(block, /SLOT_L1_JOB_STATUS:/);
  assert.match(gate, /SLOT_\{key\}_ENABLED/);
  assert.match(gate, /SLOT_\{key\}_OUTCOME/);
  assert.match(gate, /SLOT_\{key\}_SHA/);
  for (const slot of ['S1', 'S2', 'S3', 'G1', 'G2', 'B1', 'L1', 'L1.5', 'L2', 'L3', 'P1', 'Z1']) {
    assert.match(gate, new RegExp(`"${slot.replace('.', '\\.')}"`), `The gate does not know slot ${slot}`);
  }
  assert.match(gate, /"L1\.5": "L15"/);
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

test('self-test-quality.yml keeps a legacy and a strict slot path', () => {
  const selfTest = readFileSync(join(root, '.github/workflows/self-test-quality.yml'), 'utf8');
  const legacy = jobBlock(selfTest, 'test-quality-basic');
  const strict = jobBlock(selfTest, 'test-quality-strict-slots');
  assert.doesNotMatch(legacy, /slot-status:/);
  assert.match(strict, /needs: test-quality-basic/);
  assert.match(strict, /slot-status: >-/);
  assert.match(strict, /security: true/);
  assert.match(strict, /workflow-lint: true/);
  assert.match(strict, /typecheck: true/);
  assert.match(strict, /typecheck-command: >-/);
  assert.match(strict, /coverage-artifact-name: coverage-report-strict-slots/);
});

test('self-test-quality.yml exercises the L3 multi-browser and evidence path', () => {
  const selfTest = readFileSync(join(root, '.github/workflows/self-test-quality.yml'), 'utf8');
  const l3 = jobBlock(selfTest, 'test-quality-l3-evidence');
  assert.match(l3, /needs: test-quality-strict-slots/);
  assert.match(l3, /l3: true/);
  assert.match(l3, /l3-browsers: "chromium webkit"/);
  assert.match(l3, /l3-prepare-command:/);
  assert.match(l3, /l3-artifact-name: l3-evidence/);
  assert.match(l3, /l3-artifact-path: \.github\/fixtures\/l3-basic\/l3-evidence/);
  assert.match(l3, /l3-artifact-retention-days: 3/);

  const verify = jobBlock(selfTest, 'verify-quality-output');
  assert.match(verify, /test-quality-l3-evidence/);
  assert.match(verify, /uses: actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(verify, /name: l3-evidence/);
  assert.match(verify, /l3-evidence\/report\.txt/);
});

test('bun-quality.yml keeps the legacy job names', () => {
  assert.match(bunQuality, /name: "Worker Tests"/);
  assert.doesNotMatch(bunQuality, /slot-status:/);
});
