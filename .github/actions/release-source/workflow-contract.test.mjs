import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const workflow = readFileSync(join(root, '.github/workflows/deploy-worker.yml'), 'utf8');
const dockerWorkflow = readFileSync(join(root, '.github/workflows/deploy-docker.yml'), 'utf8');
const pagesWorkflow = readFileSync(join(root, '.github/workflows/deploy-pages.yml'), 'utf8');
const action = readFileSync(join(root, '.github/actions/release-source/action.yml'), 'utf8');
const selfTest = readFileSync(join(root, '.github/workflows/self-test-release.yml'), 'utf8');
const providerPin = readFileSync(join(root, '.github/internal-provider-pin.txt'), 'utf8').trim();

test('deploy-worker pins internal helper SHAs, not relative composite paths', () => {
  const setupPin = workflow.match(/nocoo\/base-ci\/\.github\/actions\/setup-js@([a-f0-9]{40})/)?.[1];
  assert.equal(setupPin, providerPin);
  assert.doesNotMatch(workflow, /uses: \.\/\.github\/actions/);
  assert.doesNotMatch(workflow, /release-source/);
  assert.match(workflow, /persist-credentials: false/);
});

test('deploy-worker secrets, lock, environment and artifact reuse stay bounded', () => {
  assert.match(workflow, /CLOUDFLARE_API_TOKEN:/);
  assert.match(workflow, /DEPLOY_SECRET:/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ vars\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.doesNotMatch(workflow, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /environment:\n\s+name: \$\{\{ inputs\.environment \}\}/);
  assert.doesNotMatch(workflow, /secrets: inherit/);
  assert.doesNotMatch(workflow, /wrangler-action/);
  assert.doesNotMatch(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /artifact-name:/);
  assert.match(workflow, /sparse-checkout:/);
  assert.match(workflow, /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/);
});

test('deploy-worker pins verified Actions SHAs and validates the selected local CLI', () => {
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow, new RegExp(`nocoo/base-ci/\\.github/actions/setup-js@${providerPin}`));
  assert.match(workflow, /deploy-cli:[\s\S]*default: "wrangler"/);
  assert.match(workflow, /wrangler-version:[\s\S]*default: "lockfile"/);
  assert.match(workflow, /resolve-locked-wrangler/);
  assert.match(workflow, /if: inputs\.deploy-script == '' \|\| inputs\.d1-migrations/);
  assert.match(workflow, /parsed != expected/);
  assert.match(workflow, /os\.path\.abspath/);
  assert.match(workflow, /bash -euo pipefail -c/);
  assert.doesNotMatch(workflow, /bash -lc/);
  assert.match(workflow, /deploy-script:/);
  assert.match(workflow, /install-policy:/);
});

function step(name) {
  const quoted = `      - name: "${name}"\n`;
  const unquoted = `      - name: ${name}\n`;
  const block = (workflow.includes(quoted) ? workflow.split(quoted)[1] : workflow.split(unquoted)[1])?.split('\n      - name: ')[0];
  assert.ok(block, `Missing step: ${name}`);
  const run = block.split('        run: ')[1];
  assert.ok(run, `Missing run: ${name}`);
  return run.startsWith('|\n') ? run.slice(2).replace(/^          /gm, '') : run.trim();
}

function fixture(t, overrides = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), 'base-ci-worker-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GITHUB_WORKSPACE: rootDir,
    GITHUB_OUTPUT: join(rootDir, 'output'),
    GITHUB_ENV: join(rootDir, 'gh-env'),
    GITHUB_REF: 'refs/heads/main',
    CALL_LOG: join(rootDir, 'calls'),
    WORKDIR: '.',
    WRANGLER_WD: '.',
    PACKAGE_MANAGER: 'bun',
    RUNTIME_VERSION: '1.4.2',
    NODE_VERSION: '',
    INSTALL_POLICY: 'blocked',
    DEPLOY_CLI: 'wrangler',
    DEPLOY_SCRIPT: '',
    DEPLOY_SECRET_NAME: '',
    WRANGLER_VERSION: '4.131.1',
    CF_VERSION: '',
    WRANGLER_CONFIG: '',
    WRANGLER_WORKING_DIRECTORY: '',
    D1_MIGRATIONS: 'false',
    D1_DATABASES: '',
    D1_COMMAND: '',
    DEPLOY_COMMAND: '',
    VERIFY_COMMAND: 'true',
    ...overrides,
  };
  function binary(cli, version, directory = '.') {
    const binPath = join(rootDir, directory, 'node_modules/.bin', cli);
    mkdirSync(dirname(binPath), { recursive: true });
    writeFileSync(
      binPath,
      `#!/usr/bin/env python3\nimport json, os, sys\nwith open(os.environ['CALL_LOG'], 'a') as f:\n    f.write(json.dumps([${JSON.stringify(cli)}, *sys.argv[1:]]) + '\\n')\nif sys.argv[1:] == ['--version']:\n    print(${JSON.stringify(version)})\n`,
    );
    chmodSync(binPath, 0o755);
    return binPath;
  }
  function run(name, expected = 0) {
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', step(name)], { cwd: rootDir, env, encoding: 'utf8' });
    assert.equal(result.status, expected, `${name}: ${result.stdout}\n${result.stderr}`);
    return result;
  }
  function resolveWranglerFromLockfiles() {
    if (env.DEPLOY_CLI !== 'wrangler') return;
    if (env.WRANGLER_VERSION && env.WRANGLER_VERSION !== 'lockfile') return;
    if (env.DEPLOY_SCRIPT && env.D1_MIGRATIONS !== 'true') return;
    const script = join(dirname(fileURLToPath(import.meta.url)), '../resolve-locked-wrangler/resolve_locked_wrangler.py');
    const result = spawnSync('python3', [script], { cwd: rootDir, env: { ...env, WORKING_DIRECTORY: env.WORKDIR || '.' }, encoding: 'utf8' });
    assert.equal(result.status, 0, `resolve locked wrangler: ${result.stdout}\n${result.stderr}`);
    env.RESOLVED_WRANGLER_VERSION = readFileSync(env.GITHUB_OUTPUT, 'utf8').match(/wrangler-version=(.+)/)?.[1] ?? '';
  }
  function locate() {
    resolveWranglerFromLockfiles();
    env.CLI_VERSION = env.DEPLOY_CLI === 'cf' ? env.CF_VERSION : (env.RESOLVED_WRANGLER_VERSION || env.WRANGLER_VERSION);
    run('D1: Preflight — Locate locked deployment CLI');
    env.CLI_BIN = readFileSync(env.GITHUB_OUTPUT, 'utf8').trim().split('bin=').at(-1);
  }
  return { env, root: rootDir, binary, run, locate, calls: () => readFileSync(env.CALL_LOG, 'utf8').trim().split('\n').map(JSON.parse) };
}

test('legacy Wrangler defaults use its local version, config and remote named migrations', t => {
  const f = fixture(t, { D1_MIGRATIONS: 'true', D1_DATABASES: 'app-db,other_db', WRANGLER_CONFIG: 'wrangler.jsonc' });
  f.binary('wrangler', '4.131.1');
  f.run('D1: Preflight — Verify main ref and inputs');
  f.locate();
  f.run('D3: Migrate — Apply D1 migrations');
  f.run('D4: Deploy — Deploy Worker');
  assert.deepEqual(f.calls(), [
    ['wrangler', '--version'],
    ['wrangler', 'd1', 'migrations', 'apply', 'app-db', '--remote', '--config', 'wrangler.jsonc'],
    ['wrangler', 'd1', 'migrations', 'apply', 'other_db', '--remote', '--config', 'wrangler.jsonc'],
    ['wrangler', 'deploy', '--config', 'wrangler.jsonc'],
  ]);
});

test('cf banner prerelease version, UUID migrations and production prebuilt deploy need no Wrangler', t => {
  const db = '00000000-1234-5678-abcd-000000000001';
  const f = fixture(t, { DEPLOY_CLI: 'cf', CF_VERSION: '1.0.0-beta.12', WRANGLER_VERSION: '', D1_MIGRATIONS: 'true', D1_DATABASES: db });
  f.binary('cf', '\u{1f34a}\u2601\ufe0f  cf \u00b7 v1.0.0-beta.12\n\u2500\u2500\u2500\u2500');
  f.run('D1: Preflight — Verify main ref and inputs');
  f.locate();
  f.run('D3: Migrate — Apply D1 migrations');
  f.run('D4: Deploy — Deploy Worker');
  assert.deepEqual(f.calls(), [
    ['cf', '--version'], ['cf', 'd1', 'migrations', 'apply', db],
    ['cf', 'deploy', '--prebuilt', '--mode', 'production'],
  ]);
  f.env.D1_DATABASES = 'binding-name';
  f.run('D3: Migrate — Apply D1 migrations', 1);
  assert.equal(f.calls().length, 3);
});

test('lockfile mode reads agreeing bun and npm lockfiles before locating Wrangler', t => {
  const f = fixture(t, { WRANGLER_VERSION: 'lockfile' });
  writeFileSync(join(f.root, 'bun.lock'), '"wrangler": ["wrangler@4.149.0", {}]');
  writeFileSync(join(f.root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/wrangler': { version: '4.149.0' } } }));
  f.binary('wrangler', '4.149.0');
  f.run('D1: Preflight — Verify main ref and inputs');
  f.locate();
  f.run('D4: Deploy — Deploy Worker');
  assert.deepEqual(f.calls(), [['wrangler', '--version'], ['wrangler', 'deploy']]);
});

test('lockfile mode fails when bun and npm disagree', t => {
  const f = fixture(t, { WRANGLER_VERSION: 'lockfile' });
  writeFileSync(join(f.root, 'bun.lock'), '"wrangler": ["wrangler@4.149.0", {}]');
  writeFileSync(join(f.root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/wrangler': { version: '4.131.1' } } }));
  f.run('D1: Preflight — Verify main ref and inputs');
  const script = join(dirname(fileURLToPath(import.meta.url)), '../resolve-locked-wrangler/resolve_locked_wrangler.py');
  const result = spawnSync('python3', [script], {
    cwd: f.root,
    env: { ...f.env, WORKING_DIRECTORY: f.env.WORKDIR || '.' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /mismatch/);
});

test('CLI version validation fails closed for missing, floating, mismatched or global-only binaries', t => {
  for (const cli of ['cf', 'wrangler']) {
    const f = fixture(t, { DEPLOY_CLI: cli });
    const key = cli === 'cf' ? 'CF_VERSION' : 'WRANGLER_VERSION';
    for (const version of ['latest', '^1.0.0', '1.0']) {
      f.env[key] = version;
      f.run('D1: Preflight — Verify main ref and inputs', 1);
    }
    if (cli === 'cf') {
      f.env[key] = '';
      f.run('D1: Preflight — Verify main ref and inputs', 1);
    }
    f.env[key] = f.env.CLI_VERSION = '1.0.0-beta.12';
    f.run('D1: Preflight — Verify main ref and inputs');
    const globalBin = f.binary(cli, '1.0.0-beta.12', 'global');
    f.env.PATH = `${dirname(globalBin)}:${process.env.PATH}`;
    f.run('D1: Preflight — Locate locked deployment CLI', 1);
    f.binary(cli, '1.0.0-beta.9');
    f.run('D1: Preflight — Locate locked deployment CLI', 1);
    f.binary(cli, 'unknown');
    f.run('D1: Preflight — Locate locked deployment CLI', 1);
  }
});

test('CLI lookup prefers deployment directory then install directory then repository root', t => {
  const f = fixture(t, { WRANGLER_WD: 'worker', WORKDIR: 'app' });
  for (const directory of ['.', 'app', 'worker']) {
    const binPath = f.binary('wrangler', '4.131.1', directory);
    f.locate();
    assert.equal(f.env.CLI_BIN, binPath);
  }
});

test('script override without shared migrations requires neither CLI version nor binary', t => {
  for (const cli of ['wrangler', 'cf']) {
    const f = fixture(t, { DEPLOY_CLI: cli, WRANGLER_VERSION: '', CF_VERSION: '', DEPLOY_SCRIPT: 'printf script > script-ran' });
    f.run('D1: Preflight — Verify main ref and inputs');
    f.run('D4: Deploy — Run project deploy script');
    assert.equal(readFileSync(join(f.root, 'script-ran'), 'utf8'), 'script');
    f.env.D1_MIGRATIONS = 'true';
    f.env.D1_DATABASES = 'app-db';
    if (cli === 'cf') {
      f.run('D1: Preflight — Verify main ref and inputs', 1);
      continue;
    }
    f.run('D1: Preflight — Verify main ref and inputs');
    const script = join(dirname(fileURLToPath(import.meta.url)), '../resolve-locked-wrangler/resolve_locked_wrangler.py');
    const missing = spawnSync('python3', [script], {
      cwd: f.root,
      env: { ...f.env, WORKING_DIRECTORY: f.env.WORKDIR || '.' },
      encoding: 'utf8',
    });
    assert.equal(missing.status, 1, missing.stderr);
  }
  assert.match(workflow, /name: "D1: Preflight — Locate locked deployment CLI"\n\s+if: inputs\.deploy-script == '' \|\| inputs\.d1-migrations/);
  assert.match(workflow, /name: "D4: Deploy — Deploy Worker"\n\s+if: inputs\.deploy-script == ''/);
});

test('invalid branch ref or empty verify-command fails fast in preflight', t => {
  fixture(t, { GITHUB_REF: 'refs/pull/1/merge' }).run('D1: Preflight — Verify main ref and inputs', 1);
  fixture(t, { VERIFY_COMMAND: '   ' }).run('D1: Preflight — Verify main ref and inputs', 1);
});

test('D1-D5 steps preserve strict execution order in deploy-worker, deploy-docker and deploy-pages', () => {
  const names = [
    'D1: Preflight — Verify main ref and inputs',
    'D1: Preflight — Checkout',
    'D1: Preflight — Normalize paths and credentials',
    'D1: Preflight — Resolve locked Wrangler version',
    'D1: Preflight — Setup JS',
    'D1: Preflight — Locate locked deployment CLI',
    'D2: Artifact — Download CI build artifact',
    'D2: Artifact — Unpack CI build artifact',
    'D2: Artifact — Build',
    'D3: Migrate — Apply D1 migrations',
    'D4: Deploy — Run project deploy script',
    'D4: Deploy — Deploy Worker',
    'D5: Verify — Production health check',
  ];
  const positions = names.map((name) => workflow.indexOf(`      - name: "${name}"\n`));
  assert.ok(positions.every((position) => position >= 0), `Missing step in positions: ${positions}`);
  assert.deepEqual(positions, positions.toSorted((a, b) => a - b));
  assert.doesNotMatch(workflow, /toJSON\(secrets\)/);

  assert.match(dockerWorkflow, /d1-preflight:/);
  assert.match(dockerWorkflow, /d2-artifact:/);
  assert.match(dockerWorkflow, /d4-deploy:/);
  assert.match(dockerWorkflow, /deploy-over-ssh:/);
  assert.match(dockerWorkflow, /scope=\$\{\{ matrix\.image\.cacheScope \}\}/);

  assert.match(pagesWorkflow, /D1: Preflight/);
  assert.match(pagesWorkflow, /D2: Artifact/);
  assert.match(pagesWorkflow, /D4: Deploy/);
  assert.match(pagesWorkflow, /D5: Verify/);
});

test('release-source helper action keeps run/tag/manual inputs for legacy test coverage', () => {
  for (const name of ['github-token', 'expected-workflow-path', 'expected-workflow-name', 'expected-branch', 'source-run-id', 'tag', 'source-sha', 'require-fresh-main']) {
    assert.match(action, new RegExp(`^  ${name}:`, 'm'));
  }
});

test('self-test-release runs helper tests and does not deploy', () => {
  assert.match(selfTest, /node --test \.github\/actions\/docker-manifest\/index\.test\.mjs/);
  assert.match(selfTest, /node --test \.github\/actions\/release-source\/workflow-contract\.test\.mjs/);
  assert.match(selfTest, /node --test \.github\/slots\/internal-pin\.test\.mjs/);
  assert.doesNotMatch(selfTest, /deploy-worker\.yml@/);
  assert.doesNotMatch(selfTest, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets/);
});
