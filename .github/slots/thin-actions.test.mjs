import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function loadYaml(relPath) {
  const fullPath = join(root, relPath);
  const raw = readFileSync(fullPath, 'utf8');
  const json = execFileSync(
    'python3',
    ['-c', 'import json, sys, yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))'],
    { input: raw, encoding: 'utf8' },
  );
  return { raw, data: JSON.parse(json) };
}

test('lint-workflows action satisfies thin S3 composite contract', () => {
  const { raw, data } = loadYaml('.github/actions/lint-workflows/action.yml');
  assert.equal(data.runs.using, 'composite');
  assert.deepEqual(Object.keys(data.inputs), ['files', 'required-reusable-workflow']);
  assert.equal(data.inputs.files.default, '');
  assert.equal(data.inputs['required-reusable-workflow'].default, '');

  assert.doesNotMatch(raw, /yamllint/);
  assert.doesNotMatch(raw, /setup-js/);

  assert.match(raw, /https:\/\/github\.com\/rhysd\/actionlint\/releases\/download\/v\$\{ACTIONLINT_VERSION\}\/actionlint_\$\{ACTIONLINT_VERSION\}_linux_amd64\.tar\.gz/);
  assert.match(raw, /ACTIONLINT_VERSION="1\.7\.12"/);
  assert.match(raw, /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8/);
  assert.match(raw, /\$RUNNER_TEMP/);
  assert.match(raw, /-shellcheck= -pyflakes=/);
  assert.match(raw, /\[a-f0-9\]\{40\}/);
  assert.match(raw, /REQUIRED_WORKFLOW/);

  for (const step of data.runs.steps) {
    if (step.run) {
      assert.equal(step.shell, 'bash');
    }
  }
});

test('lint-workflows python check validates full-SHA uses pins and required-reusable-workflow', () => {
  const { data } = loadYaml('.github/actions/lint-workflows/action.yml');
  const pyStep = data.runs.steps.find((s) => s.run && s.run.includes('python3'));
  assert.ok(pyStep, 'missing python uses-pin check step');
  const match = pyStep.run.match(/<<'PY'\n([\s\S]*?)\nPY/);
  assert.ok(match, 'python heredoc missing');
  const script = match[1];

  const dir = mkdtempSync(join(tmpdir(), 'lint-wf-test-'));
  try {
    mkdirSync(join(dir, '.github/workflows'), { recursive: true });
    writeFileSync(
      join(dir, '.github/workflows/ok.yml'),
      [
        'name: OK',
        'on: push',
        'jobs:',
        '  reusable:',
        '    uses: nocoo/base-ci/.github/workflows/quality.yml@725b7dd49aae3fc3186af36a60965449e55c0853',
        '  local:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: ./.github/actions/scan-secrets',
        '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      ].join('\n'),
    );

    const okOut = execFileSync('python3', ['-c', script], {
      cwd: dir,
      env: {
        ...process.env,
        WORKFLOW_FILES: '',
        REQUIRED_WORKFLOW: 'nocoo/base-ci/.github/workflows/quality.yml',
      },
      encoding: 'utf8',
    });
    assert.match(okOut, /Validated 1 workflow file\(s\)/);

    assert.throws(
      () =>
        execFileSync('python3', ['-c', script], {
          cwd: dir,
          env: {
            ...process.env,
            WORKFLOW_FILES: '.github/workflows/ok.yml',
            REQUIRED_WORKFLOW: 'nocoo/base-ci/.github/workflows/missing.yml',
          },
          stdio: 'pipe',
        }),
      /Missing required reusable workflow/,
    );

    writeFileSync(
      join(dir, '.github/workflows/bad.yml'),
      [
        'name: Bad',
        'on: push',
        'jobs:',
        '  test:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
      ].join('\n'),
    );

    assert.throws(
      () =>
        execFileSync('python3', ['-c', script], {
          cwd: dir,
          env: {
            ...process.env,
            WORKFLOW_FILES: '.github/workflows/bad.yml',
            REQUIRED_WORKFLOW: '',
          },
          stdio: 'pipe',
        }),
      /must pin a full 40-hex commit SHA/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scan-secrets action satisfies thin G1 composite contract', () => {
  const { raw, data } = loadYaml('.github/actions/scan-secrets/action.yml');
  assert.equal(data.runs.using, 'composite');
  assert.deepEqual(Object.keys(data.inputs), ['working-directory', 'config', 'ignore-path']);
  assert.equal(data.inputs['working-directory'].default, '.');
  assert.equal(data.inputs.config.default, '');
  assert.equal(data.inputs['ignore-path'].default, '');

  assert.doesNotMatch(raw, /osv-scanner/);
  assert.doesNotMatch(raw, /setup-js/);

  assert.match(raw, /GITLEAKS_VERSION="8\.30\.1"/);
  assert.match(raw, /551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb/);
  assert.match(raw, /dir \. --no-banner --redact --log-level error/);
  assert.match(raw, /\.gitleaks\.toml/);
  assert.match(raw, /\.gitleaksignore/);
  assert.match(raw, /--config=/);
  assert.match(raw, /--gitleaks-ignore-path=/);

  const scanStep = data.runs.steps.find((s) => s.run && s.run.includes('gitleaks'));
  assert.ok(scanStep);
  const runStep = data.runs.steps[data.runs.steps.length - 1];
  assert.equal(runStep['working-directory'], '${{ inputs.working-directory }}');
  for (const step of data.runs.steps) {
    if (step.run) {
      assert.equal(step.shell, 'bash');
    }
  }
});

test('scan-dependencies action satisfies thin G2 composite contract', () => {
  const { raw, data } = loadYaml('.github/actions/scan-dependencies/action.yml');
  assert.equal(data.runs.using, 'composite');
  assert.deepEqual(Object.keys(data.inputs), ['lockfiles', 'working-directory', 'config']);
  assert.equal(data.inputs.lockfiles.required, true);
  assert.equal(data.inputs['working-directory'].default, '.');
  assert.equal(data.inputs.config.default, '');

  assert.doesNotMatch(raw, /gitleaks/);
  assert.doesNotMatch(raw, /setup-js/);

  assert.match(raw, /OSV_VERSION="2\.5\.1"/);
  assert.match(raw, /f9f25499a2c8cc367b3af45df2ea7eeca7fbccceab9c35079968f4b3652194be/);
  assert.match(raw, /osv-scanner\.toml/);
  assert.match(raw, /--config=/);
  assert.match(raw, /--lockfile=/);
  assert.match(raw, /::error::/);

  const scanStep = data.runs.steps[data.runs.steps.length - 1];
  assert.equal(scanStep['working-directory'], '${{ inputs.working-directory }}');
  for (const step of data.runs.steps) {
    if (step.run) {
      assert.equal(step.shell, 'bash');
    }
  }
});

test('self-test-quality.yml exercises all 3 thin actions under canonical slot names', () => {
  const { data } = loadYaml('.github/workflows/self-test-quality.yml');
  const expected = {
    'S3: Workflow (Thin Action)': './.github/actions/lint-workflows',
    'G1: Secrets (Thin Action)': './.github/actions/scan-secrets',
    'G2: Dependencies (Thin Action)': './.github/actions/scan-dependencies',
  };
  const jobs = Object.values(data.jobs);
  for (const [name, actionRef] of Object.entries(expected)) {
    const job = jobs.find((j) => j.name === name);
    assert.ok(job, `missing self-test-quality job named "${name}"`);
    assert.ok(
      job.steps.some((s) => s.uses === actionRef),
      `job "${name}" must invoke ${actionRef}`,
    );
  }
});
