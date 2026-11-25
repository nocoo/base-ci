import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('setup-playwright action satisfies thin L4 composite contract', () => {
  const { raw, data } = loadYaml('.github/actions/setup-playwright/action.yml');
  assert.equal(data.runs.using, 'composite');
  assert.deepEqual(Object.keys(data.inputs), [
    'working-directory',
    'package-manager',
    'browsers',
    'install-deps',
    'cache',
  ]);
  assert.equal(data.inputs['working-directory'].default, '.');
  assert.equal(data.inputs['package-manager'].default, 'bun');
  assert.equal(data.inputs.browsers.default, 'chromium');
  assert.equal(data.inputs['install-deps'].default, 'true');
  assert.equal(data.inputs.cache.default, 'true');
  assert.deepEqual(Object.keys(data.outputs), ['playwright-version', 'cache-hit']);

  const cacheStep = data.runs.steps.find((s) => s.id === 'pw-cache');
  assert.ok(cacheStep, 'missing pw-cache step');
  assert.equal(cacheStep.uses, 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9');
  assert.match(raw, /PLAYWRIGHT_BROWSERS_PATH/);
  assert.match(raw, /install --with-deps/);
  assert.match(raw, /install-deps/);

  const installStep = data.runs.steps[data.runs.steps.length - 1];
  assert.equal(installStep['working-directory'], '${{ inputs.working-directory }}');
  for (const step of data.runs.steps) {
    if (step.run) {
      assert.equal(step.shell, 'bash');
    }
  }
});

test('setup-playwright resolve-pw resolves version, pw-bin, browsers-key, and PLAYWRIGHT_BROWSERS_PATH', () => {
  const { data } = loadYaml('.github/actions/setup-playwright/action.yml');
  const resolveStep = data.runs.steps.find((s) => s.id === 'resolve-pw');
  assert.ok(resolveStep, 'missing resolve-pw step');
  const match = resolveStep.run.match(/<<'PY'\n([\s\S]*?)\nPY/);
  assert.ok(match, 'python heredoc missing');
  const script = match[1];

  const dir = mkdtempSync(join(tmpdir(), 'setup-pw-test-'));
  try {
    const appDir = join(dir, 'apps/web');
    mkdirSync(join(appDir, 'node_modules/@playwright/test'), { recursive: true });
    mkdirSync(join(appDir, 'node_modules/.bin'), { recursive: true });
    writeFileSync(
      join(appDir, 'node_modules/@playwright/test/package.json'),
      JSON.stringify({ name: '@playwright/test', version: '1.52.0' }),
    );
    const binPath = join(appDir, 'node_modules/.bin/playwright');
    writeFileSync(binPath, '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(binPath, 0o755);

    const out1 = join(dir, 'out1.txt');
    const env1 = join(dir, 'env1.txt');
    execFileSync('python3', ['-c', script], {
      cwd: dir,
      env: {
        ...process.env,
        GITHUB_WORKSPACE: dir,
        GITHUB_OUTPUT: out1,
        GITHUB_ENV: env1,
        IN_WORKDIR: 'apps/web',
        IN_BROWSERS: 'webkit chromium',
        PLAYWRIGHT_BROWSERS_PATH: '',
      },
      encoding: 'utf8',
    });

    const parsedOut1 = Object.fromEntries(
      readFileSync(out1, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
    assert.equal(parsedOut1['playwright-version'], '1.52.0');
    assert.equal(parsedOut1['browsers-key'], 'chromium-webkit');
    assert.ok(parsedOut1['cache-path'].endsWith('.cache/ms-playwright'));
    assert.match(parsedOut1['pw-bin'], /apps\/web\/node_modules\/\.bin\/playwright$/);
    assert.match(readFileSync(env1, 'utf8'), /^PLAYWRIGHT_BROWSERS_PATH=.*ms-playwright/m);

    // Fallback to package.json version stripping ^/~/>= and keeping existing PLAYWRIGHT_BROWSERS_PATH
    const pkgOnlyDir = join(dir, 'pkg-only');
    mkdirSync(pkgOnlyDir, { recursive: true });
    writeFileSync(
      join(pkgOnlyDir, 'package.json'),
      JSON.stringify({ devDependencies: { playwright: '^1.49.1' } }),
    );
    const out2 = join(dir, 'out2.txt');
    const env2 = join(dir, 'env2.txt');
    writeFileSync(env2, '');
    execFileSync('python3', ['-c', script], {
      cwd: dir,
      env: {
        ...process.env,
        GITHUB_WORKSPACE: pkgOnlyDir,
        GITHUB_OUTPUT: out2,
        GITHUB_ENV: env2,
        IN_WORKDIR: '.',
        IN_BROWSERS: 'chromium',
        PLAYWRIGHT_BROWSERS_PATH: '/custom/pw-cache',
      },
      encoding: 'utf8',
    });
    const parsedOut2 = Object.fromEntries(
      readFileSync(out2, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
    assert.equal(parsedOut2['playwright-version'], '1.49.1');
    assert.equal(parsedOut2['cache-path'], '/custom/pw-cache');
    assert.equal(parsedOut2['pw-bin'], '');
    assert.equal(readFileSync(env2, 'utf8'), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setup-playwright install step uses single-pass install rules without double-installing deps', () => {
  const { data } = loadYaml('.github/actions/setup-playwright/action.yml');
  const installStep = data.runs.steps[data.runs.steps.length - 1];
  const dir = mkdtempSync(join(tmpdir(), 'setup-pw-install-'));
  try {
    const binDir = join(dir, 'node_modules/.bin');
    mkdirSync(binDir, { recursive: true });
    const logFile = join(dir, 'calls.log');
    const pwBin = join(binDir, 'playwright');
    writeFileSync(
      pwBin,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${logFile}"\n`,
    );
    chmodSync(pwBin, 0o755);

    const runInstall = (overrides) => {
      writeFileSync(logFile, '');
      const stdout = execFileSync('bash', ['-c', installStep.run], {
        cwd: dir,
        env: {
          ...process.env,
          IN_BROWSERS: 'chromium webkit',
          PKG_MGR: 'bun',
          INSTALL_DEPS: 'true',
          CACHE_HIT: 'false',
          PW_BIN: pwBin,
          RUNNER_OS: 'Linux',
          ...overrides,
        },
        encoding: 'utf8',
      });
      const lines = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      return { stdout, lines };
    };

    // Cold cache on Linux + install-deps=true -> single `install --with-deps`
    const coldLinux = runInstall({ CACHE_HIT: 'false', INSTALL_DEPS: 'true', RUNNER_OS: 'Linux' });
    assert.deepEqual(coldLinux.lines, ['install --with-deps chromium webkit']);

    // Cache hit on Linux + install-deps=true -> single `install-deps`
    const warmLinux = runInstall({ CACHE_HIT: 'true', INSTALL_DEPS: 'true', RUNNER_OS: 'Linux' });
    assert.deepEqual(warmLinux.lines, ['install-deps chromium webkit']);

    // Cache hit on macOS -> skip completely
    const warmMac = runInstall({ CACHE_HIT: 'true', INSTALL_DEPS: 'true', RUNNER_OS: 'macOS' });
    assert.deepEqual(warmMac.lines, []);
    assert.match(warmMac.stdout, /skipping install/);

    // Cold cache + install-deps=false -> `install` without `--with-deps`
    const noDeps = runInstall({ CACHE_HIT: 'false', INSTALL_DEPS: 'false', RUNNER_OS: 'Linux' });
    assert.deepEqual(noDeps.lines, ['install chromium webkit']);

    // Empty browsers fails loudly
    assert.throws(
      () => runInstall({ IN_BROWSERS: '   ' }),
      /No Playwright browsers specified/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('z1-gate action satisfies thin checkout-free Z1 composite contract', () => {
  const { raw, data } = loadYaml('.github/actions/z1-gate/action.yml');
  assert.equal(data.runs.using, 'composite');
  assert.deepEqual(Object.keys(data.inputs), [
    'needs-json',
    'expected-sha',
    'required-jobs',
    'skipped-jobs',
    'no-sha-jobs',
    'allow-extra-needs',
    'title',
  ]);
  assert.equal(data.inputs['needs-json'].required, true);
  assert.equal(data.inputs['expected-sha'].required, true);
  assert.equal(data.inputs['required-jobs'].required, true);
  assert.equal(data.inputs['skipped-jobs'].default, '');
  assert.equal(data.inputs['no-sha-jobs'].default, '');
  assert.equal(data.inputs['allow-extra-needs'].default, 'false');
  assert.equal(data.inputs.title.default, 'Z1: Gate');

  assert.doesNotMatch(raw, /\bgit\b/);
  assert.doesNotMatch(raw, /actions\/checkout/);
  for (const inputDef of Object.values(data.inputs)) {
    assert.doesNotMatch(inputDef.description || '', /\$\{\{/);
  }
  for (const step of data.runs.steps) {
    if (step.run) {
      assert.equal(step.shell, 'bash');
    }
  }
});

test('z1-gate python check verifies required/skipped/no-sha/extra jobs and step summary', () => {
  const { data } = loadYaml('.github/actions/z1-gate/action.yml');
  const gateStep = data.runs.steps.find((s) => s.id === 'z1-gate');
  assert.ok(gateStep, 'missing z1-gate step');
  const match = gateStep.run.match(/<<'PY'\n([\s\S]*?)\nPY/);
  assert.ok(match, 'python heredoc missing');
  const script = match[1];

  const SHA = 'a'.repeat(40);
  const OTHER_SHA = 'b'.repeat(40);
  const dir = mkdtempSync(join(tmpdir(), 'z1-gate-test-'));
  try {
    const runGate = (overrides) => {
      const summaryFile = join(dir, 'summary.md');
      const outputFile = join(dir, 'output.txt');
      writeFileSync(summaryFile, '');
      writeFileSync(outputFile, '');
      try {
        const stdout = execFileSync('python3', ['-c', script], {
          cwd: dir,
          env: {
            ...process.env,
            GITHUB_STEP_SUMMARY: summaryFile,
            GITHUB_OUTPUT: outputFile,
            IN_EXPECTED_SHA: SHA,
            IN_REQUIRED_JOBS: 's1=S1: Types,l1=L1: Unit,g1=G1: Secrets',
            IN_SKIPPED_JOBS: 'l4=L4: E2E',
            IN_NO_SHA_JOBS: 'g1',
            IN_ALLOW_EXTRA_NEEDS: 'false',
            IN_TITLE: 'Native Z1 Gate',
            IN_NEEDS_JSON: JSON.stringify({
              s1: { result: 'success', outputs: { 'tested-sha': SHA } },
              l1: { result: 'success', outputs: { 'tested-sha': SHA } },
              g1: { result: 'success', outputs: {} },
              l4: { result: 'skipped', outputs: {} },
            }),
            ...overrides,
          },
          encoding: 'utf8',
          stdio: 'pipe',
        });
        return {
          ok: true,
          stdout,
          summary: readFileSync(summaryFile, 'utf8'),
          output: readFileSync(outputFile, 'utf8'),
        };
      } catch (err) {
        return {
          ok: false,
          stderr: String(err.stderr || ''),
          stdout: String(err.stdout || ''),
          summary: readFileSync(summaryFile, 'utf8'),
        };
      }
    };

    // Pass case + summary + no-sha-jobs + skipped-jobs
    const pass = runGate({});
    assert.equal(pass.ok, true, pass.stderr);
    assert.match(pass.summary, /### Native Z1 Gate/);
    assert.match(pass.summary, /\| S1: Types \(`s1`\) \| required \| success \|/);
    assert.match(pass.summary, /\(exempt\)/);
    assert.match(pass.summary, /\| L4: E2E \(`l4`\) \| skipped \| skipped \|/);
    assert.match(pass.output, new RegExp(`tested-sha=${SHA}`));

    // Failed required job
    const failedJob = runGate({
      IN_NEEDS_JSON: JSON.stringify({
        s1: { result: 'failure', outputs: { 'tested-sha': SHA } },
        l1: { result: 'success', outputs: { 'tested-sha': SHA } },
        g1: { result: 'success', outputs: {} },
        l4: { result: 'skipped', outputs: {} },
      }),
    });
    assert.equal(failedJob.ok, false);
    assert.match(failedJob.stderr, /::error::Required job 's1'.*result 'failure'/);

    // Wrong tested-sha
    const wrongSha = runGate({
      IN_NEEDS_JSON: JSON.stringify({
        s1: { result: 'success', outputs: { 'tested-sha': OTHER_SHA } },
        l1: { result: 'success', outputs: { 'tested-sha': SHA } },
        g1: { result: 'success', outputs: {} },
        l4: { result: 'skipped', outputs: {} },
      }),
    });
    assert.equal(wrongSha.ok, false);
    assert.match(wrongSha.stderr, /::error::Required job 's1'.*does not match expected-sha/);

    // Missing tested-sha on non-exempt job
    const missingSha = runGate({
      IN_NEEDS_JSON: JSON.stringify({
        s1: { result: 'success', outputs: {} },
        l1: { result: 'success', outputs: { 'tested-sha': SHA } },
        g1: { result: 'success', outputs: {} },
        l4: { result: 'skipped', outputs: {} },
      }),
    });
    assert.equal(missingSha.ok, false);
    assert.match(missingSha.stderr, /::error::Required job 's1'.*does not match expected-sha/);

    // Non-skipped skipped-job
    const nonSkipped = runGate({
      IN_NEEDS_JSON: JSON.stringify({
        s1: { result: 'success', outputs: { 'tested-sha': SHA } },
        l1: { result: 'success', outputs: { 'tested-sha': SHA } },
        g1: { result: 'success', outputs: {} },
        l4: { result: 'success', outputs: { 'tested-sha': SHA } },
      }),
    });
    assert.equal(nonSkipped.ok, false);
    assert.match(nonSkipped.stderr, /::error::Skipped job 'l4'.*expected 'skipped'/);

    // Extra undeclared job rejected when allow-extra-needs=false, allowed when true
    const extraRejected = runGate({
      IN_NEEDS_JSON: JSON.stringify({
        s1: { result: 'success', outputs: { 'tested-sha': SHA } },
        l1: { result: 'success', outputs: { 'tested-sha': SHA } },
        g1: { result: 'success', outputs: {} },
        l4: { result: 'skipped', outputs: {} },
        rogue: { result: 'success', outputs: {} },
      }),
    });
    assert.equal(extraRejected.ok, false);
    assert.match(extraRejected.stderr, /::error::Undeclared job 'rogue'/);

    const extraAllowed = runGate({
      IN_ALLOW_EXTRA_NEEDS: 'true',
      IN_NEEDS_JSON: JSON.stringify({
        s1: { result: 'success', outputs: { 'tested-sha': SHA } },
        l1: { result: 'success', outputs: { 'tested-sha': SHA } },
        g1: { result: 'success', outputs: {} },
        l4: { result: 'skipped', outputs: {} },
        extra_ok: { result: 'success', outputs: {} },
      }),
    });
    assert.equal(extraAllowed.ok, true, extraAllowed.stderr);
    assert.match(extraAllowed.summary, /INFO \(extra\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('self-test-quality.yml exercises all 5 thin actions under canonical slot names', () => {
  const { data } = loadYaml('.github/workflows/self-test-quality.yml');
  const expected = {
    'S3: Workflow (Thin Action)': './.github/actions/lint-workflows',
    'G1: Secrets (Thin Action)': './.github/actions/scan-secrets',
    'G2: Dependencies (Thin Action)': './.github/actions/scan-dependencies',
    'L4: E2E (Thin Action)': './.github/actions/setup-playwright',
    'Z1: Gate (Thin Action)': './.github/actions/z1-gate',
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
  assert.deepEqual(data.jobs['test-thin-z1-gate'].needs, ['test-thin-setup-playwright']);
});
