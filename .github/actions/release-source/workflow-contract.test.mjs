import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
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

test('deploy-worker pins verified Actions SHAs and validates the selected local CLI', () => {
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow, /nocoo\/base-ci\/\.github\/actions\/setup-js@081cdf665b9c67f233abfcc9242ce0be76ce2bb4/);
  assert.match(workflow, /deploy-cli:[\s\S]*default: "wrangler"/);
  assert.match(workflow, /if: inputs.deploy-script == '' \|\| inputs.d1-migrations/);
  assert.match(workflow, /parsed != expected/);
  assert.match(workflow, /os.path.abspath/);
  assert.match(workflow, /bash -euo pipefail -c/);
  assert.doesNotMatch(workflow, /bash -lc/);
  assert.doesNotMatch(workflow, /download-artifact/);
  assert.doesNotMatch(workflow, /artifact-mode/);
  assert.match(workflow, /deploy-script:/);
  assert.match(workflow, /install-policy:/);
});

function step(name) {
  const block = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - name: ')[0];
  assert.ok(block, `Missing step: ${name}`);
  const run = block.split('        run: ')[1];
  assert.ok(run, `Missing run: ${name}`);
  return run.startsWith('|\n') ? run.slice(2).replace(/^          /gm, '') : run.trim();
}

function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'base-ci-worker-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env, GITHUB_WORKSPACE: root, GITHUB_OUTPUT: join(root, 'output'),
    CALL_LOG: join(root, 'calls'), WORKDIR: '.', WRANGLER_WD: '.',
    PACKAGE_MANAGER: 'bun', RUNTIME_VERSION: '1.4.2', NODE_VERSION: '',
    INSTALL_POLICY: 'blocked', DEPLOY_CLI: 'wrangler', DEPLOY_SCRIPT: '',
    WRANGLER_VERSION: '4.131.1', CF_VERSION: '', WRANGLER_CONFIG: '',
    WRANGLER_WORKING_DIRECTORY: '', D1_MIGRATIONS: 'false', D1_DATABASES: '',
    D1_COMMAND: '', DEPLOY_COMMAND: '', ...overrides,
  };
  function binary(cli, version, directory = '.') {
    const path = join(root, directory, 'node_modules/.bin', cli);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `#!/usr/bin/env python3\nimport json, os, sys\nwith open(os.environ['CALL_LOG'], 'a') as f:\n    f.write(json.dumps([${JSON.stringify(cli)}, *sys.argv[1:]]) + '\\n')\nif sys.argv[1:] == ['--version']:\n    print(${JSON.stringify(version)})\n`);
    chmodSync(path, 0o755);
    return path;
  }
  function run(name, expected = 0) {
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', step(name)], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, expected, `${name}: ${result.stdout}\n${result.stderr}`);
    return result;
  }
  function locate() {
    env.CLI_VERSION = env.DEPLOY_CLI === 'cf' ? env.CF_VERSION : env.WRANGLER_VERSION;
    run('Locate locked deployment CLI');
    env.CLI_BIN = readFileSync(env.GITHUB_OUTPUT, 'utf8').trim().split('bin=').at(-1);
  }
  return { env, root, binary, run, locate, calls: () => readFileSync(env.CALL_LOG, 'utf8').trim().split('\n').map(JSON.parse) };
}

test('legacy Wrangler defaults use its local version, config and remote named migrations', t => {
  const f = fixture(t, { D1_MIGRATIONS: 'true', D1_DATABASES: 'app-db,other_db', WRANGLER_CONFIG: 'wrangler.jsonc' });
  f.binary('wrangler', '4.131.1');
  f.run('Reject floating versions and unknown policies');
  f.locate();
  f.run('Apply D1 migrations');
  f.run('Deploy Worker');
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
  f.run('Reject floating versions and unknown policies');
  f.locate();
  f.run('Apply D1 migrations');
  f.run('Deploy Worker');
  assert.deepEqual(f.calls(), [
    ['cf', '--version'], ['cf', 'd1', 'migrations', 'apply', db],
    ['cf', 'deploy', '--prebuilt', '--mode', 'production'],
  ]);
  f.env.D1_DATABASES = 'binding-name';
  f.run('Apply D1 migrations', 1);
  assert.equal(f.calls().length, 3);
});

test('CLI version validation fails closed for missing, floating, mismatched or global-only binaries', t => {
  for (const cli of ['cf', 'wrangler']) {
    const f = fixture(t, { DEPLOY_CLI: cli });
    const key = cli === 'cf' ? 'CF_VERSION' : 'WRANGLER_VERSION';
    for (const version of ['', 'latest', '^1.0.0', '1.0']) {
      f.env[key] = version;
      f.run('Reject floating versions and unknown policies', 1);
    }
    f.env[key] = f.env.CLI_VERSION = '1.0.0-beta.12';
    f.run('Reject floating versions and unknown policies');
    const global = f.binary(cli, '1.0.0-beta.12', 'global');
    f.env.PATH = `${dirname(global)}:${process.env.PATH}`;
    f.run('Locate locked deployment CLI', 1);
    f.binary(cli, '1.0.0-beta.9');
    f.run('Locate locked deployment CLI', 1);
    f.binary(cli, 'unknown');
    f.run('Locate locked deployment CLI', 1);
  }
});

test('CLI lookup prefers deployment directory then install directory then repository root', t => {
  const f = fixture(t, { WRANGLER_WD: 'worker', WORKDIR: 'app' });
  for (const directory of ['.', 'app', 'worker']) {
    const path = f.binary('wrangler', '4.131.1', directory);
    f.locate();
    assert.equal(f.env.CLI_BIN, path);
  }
});

test('script override without shared migrations requires neither CLI version nor binary', t => {
  for (const cli of ['wrangler', 'cf']) {
    const f = fixture(t, { DEPLOY_CLI: cli, WRANGLER_VERSION: '', CF_VERSION: '', DEPLOY_SCRIPT: 'printf script > script-ran' });
    f.run('Reject floating versions and unknown policies');
    f.run('Run project deploy script');
    assert.equal(readFileSync(join(f.root, 'script-ran'), 'utf8'), 'script');
    f.env.D1_MIGRATIONS = 'true';
    f.env.D1_DATABASES = 'app-db';
    f.run('Reject floating versions and unknown policies', 1);
  }
  assert.match(workflow, /name: Locate locked deployment CLI\n\s+if: inputs.deploy-script == '' \|\| inputs.d1-migrations/);
  assert.match(workflow, /name: Deploy Worker\n\s+if: inputs.deploy-script == ''/);
});

test('script override with shared cf migrations still verifies and uses cf', t => {
  const f = fixture(t, { DEPLOY_CLI: 'cf', CF_VERSION: '1.0.0-beta.12', WRANGLER_VERSION: '', D1_MIGRATIONS: 'true', D1_COMMAND: 'd1 migrations apply 00000000-1234-5678-abcd-000000000001 --dir drizzle --pattern */migration.sql --table custom', DEPLOY_SCRIPT: 'true' });
  f.binary('cf', '1.0.0-beta.12');
  mkdirSync(join(f.root, 'matched'));
  writeFileSync(join(f.root, 'matched/migration.sql'), '');
  f.run('Reject floating versions and unknown policies');
  f.locate();
  f.run('Apply D1 migrations');
  f.run('Run project deploy script');
  assert.deepEqual(f.calls()[1], ['cf', ...f.env.D1_COMMAND.split(' ')]);
});

test('custom subcommands preserve Wrangler and cf arguments', t => {
  for (const cli of ['wrangler', 'cf']) {
    const f = fixture(t, { DEPLOY_CLI: cli, CF_VERSION: '1.0.0-beta.12', DEPLOY_COMMAND: 'deploy --env staging', D1_COMMAND: 'd1 migrations apply app-db --remote' });
    f.binary(cli, cli === 'cf' ? '1.0.0-beta.12' : '4.131.1');
    if (cli === 'cf') {
      f.env.DEPLOY_COMMAND = 'deploy --prebuilt --mode staging';
      f.env.D1_COMMAND = 'd1 migrations apply 00000000-1234-5678-abcd-000000000001 --dir migrations';
    }
    f.locate();
    f.run('Apply D1 migrations');
    f.run('Deploy Worker');
    assert.deepEqual(f.calls().slice(1), [[cli, ...f.env.D1_COMMAND.split(' ')], [cli, ...f.env.DEPLOY_COMMAND.split(' ')]]);
  }
});

test('invalid CLI selection, cf Wrangler-only options and missing migration targets fail early', t => {
  for (const overrides of [
    { DEPLOY_CLI: 'other' }, { D1_MIGRATIONS: 'true' },
    { DEPLOY_CLI: 'cf', CF_VERSION: '1.0.0-beta.12', WRANGLER_CONFIG: 'wrangler.jsonc' },
    { DEPLOY_CLI: 'cf', CF_VERSION: '1.0.0-beta.12', WRANGLER_WORKING_DIRECTORY: 'worker' },
  ]) fixture(t, overrides).run('Reject floating versions and unknown policies', 1);
});

test('proof, checkout, CLI validation and freshness precede production writes', () => {
  const names = ['Resolve release source', 'Checkout proven SHA', 'Confirm checkout matches proven SHA', 'Setup JS and frozen install', 'Locate locked deployment CLI', 'Build', 'Require Cloudflare credentials', 'Recheck default-branch freshness', 'Apply D1 migrations', 'Run project deploy script', 'Deploy Worker', 'Verify deployment'];
  const positions = names.map(name => workflow.indexOf(`      - name: ${name}\n`));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, positions.toSorted((a, b) => a - b));
  assert.doesNotMatch(workflow, /toJSON\(secrets\)/);
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
