# Workflow integration guide

Shared GitHub Actions workflows for nocoo projects: JavaScript quality checks, native test jobs, security scans, and releases that prove which commit passed CI.

Consumers keep their triggers, project commands, deployment environment and a few switches. Package installation, runtime setup, scanning, artifact handling and release source validation live here. Pin every reference to the full commit SHA from a reviewed release. `BASE_CI_SHA` in the examples is a placeholder that must be replaced with a literal 40-character SHA.

## Choose a workflow

| Workflow | Use it for |
| --- | --- |
| [quality.yml](../.github/workflows/quality.yml) | Bun, npm or pnpm System0 slot gate: S1–S3, G1/G2, B1, L1–L4, P1, Z1 (definitions in the [System0 quality skill](https://github.com/nocoo/workflow/blob/main/agents/skills/system0-quality/SKILL.md); wiring in [slots.md](slots.md)) |
| [test-job.yml](../.github/workflows/test-job.yml) | One command with shared setup, a caller-owned runner matrix, Python or Node without JS dependencies, and optional browser/report support |
| [security.yml](../.github/workflows/security.yml) | Multiple lockfiles, directory or full-history secret scanning, or an existing project security gate |
| [workflow-lint.yml](../.github/workflows/workflow-lint.yml) | Actionlint, immutable base-ci references, optional required release template and yamllint |
| [deploy-worker.yml](../.github/workflows/deploy-worker.yml) | Same-run `D1`–`D5` Worker delivery reusing `B1` artifacts, D1 migrations, locked Wrangler/`cf`, and mandatory verify |
| [deploy-docker.yml](../.github/workflows/deploy-docker.yml) | Same-run `D1`–`D5` Docker delivery sharing CI `P1` BuildKit cache scope and deploying `@sha256` digests over SSH or GHCR push-only |
| [deploy-pages.yml](../.github/workflows/deploy-pages.yml) | Same-run `D1`–`D5` GitHub Pages delivery reusing `B1` artifacts and verifying live HTTP 200 |

The workflow files define the complete input and output contracts. `bun-quality.yml` is the older string-switch interface; new migrations use `quality.yml`. Historical behavior remains available through immutable commits and the `v2026.1`–`v2026.6` tags. The old moving `v2026` alias is not an upgrade policy.

Checks are named after [System0 slots](slots.md) (`S1` … `L4`, `P1`, `Z1`). Every slot of `quality.yml` is a top-level job, so each slot renders exactly one check named `<ID>: <Canonical Name>` (for example `quality / G1: Secrets`). `bun-quality.yml` keeps its legacy job names.

## JavaScript CI

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
permissions:
  contents: read
jobs:
  quality:
    uses: nocoo/base-ci/.github/workflows/quality.yml@BASE_CI_SHA
    with:
      runtime-version: '1.4.2'
      install-policy: blocked
      coverage-path: coverage
      build: true
      l2: true
      l2-command: bun run test:api
      l3: true
      l3-command: bun run test:e2e
```

Typecheck, lint, unit and security checks default to enabled. `build`, `l2`, `l3`, `worker` and `package-check` default to disabled. Disabling a core check requires an explanation in `disabled-check-reasons`, for example `'{"typecheck":"Plain JavaScript; no TypeScript sources"}'` with `typecheck: false`.

Commands default to the selected package manager's `run typecheck`, `run lint`, `run test:coverage` and corresponding optional scripts. Override commands when a project already has a different entry point. Commands execute through `bash -euo pipefail -c`; `cd`, pipelines, quotes and multiline scripts retain shell behavior.

`prepare-command` runs before checks in each relevant isolated job. Use it when tests need a built library. Enabling the separate `build` job does not put its output in other jobs. Worker preparation is separate: `worker-prepare-command` defaults to empty.

`quality.yml` runs every slot as its own top-level job: `S1: Types`, `S2: Lint`, `S3: Workflow`, `G1: Secrets`, `G2: Dependencies`, `B1: Build`, `L1: Unit`, `L2: Runtime`, `L3: Integration`, `L4: E2E`, `P1: Package` and `Z1: Gate`. Typecheck and lint are independent jobs with their own check, duration and tested SHA. The `L1: Unit Tests & Coverage` job always runs so it can validate `disabled-check-reasons`; its unit step is skipped when `unit` is false. No slot job uses `strategy.matrix`, so a check name stays exactly `quality / <ID>: <Name>`; several apps or architectures are built or tested serially inside one slot job.

`coverage-path` is explicitly opt-in. It must point to a real report, relative to the repository root. A requested missing report fails the job. Build artifacts use `artifact-name` and `artifact-paths`. The successful aggregate emits `tested-sha` only after every enabled job succeeds and reports the same checked out commit.

### Browser and API evidence

`l4-browsers` (or the deprecated `l3-browsers`) installs a space-separated browser list through the package manager (`playwright install --with-deps`), so `l4-browsers: "chromium webkit"` installs both.

`l3-prepare-command` prepares the L3 job (for example a build before the E2E run) and falls back to the shared `prepare-command` when it is empty. `l2-command` and `l3-command` stay separate from their preparation steps.

```yaml
jobs:
  quality:
    uses: nocoo/base-ci/.github/workflows/quality.yml@BASE_CI_SHA
    with:
      l3: true
      l4-browsers: "chromium webkit"
      l3-prepare-command: "bun run build"
      l3-command: "bun run test:e2e:pw"
      l3-artifact-name: "playwright-report"
      l3-artifact-path: |
        playwright-report/
        test-results/
      l3-artifact-retention-days: 7
      l2: true
      l2-command: "bun run test:api"
      l2-artifact-name: "api-report"
      l2-artifact-path: reports/api
      l2-artifact-retention-days: 7
```

`l3-artifact-name`, `l3-artifact-path` and `l3-artifact-retention-days` (and the matching `l2-*` inputs) upload the E2E evidence with `if: always()`, so a failed run keeps its report. A requested but missing evidence path fails the job.

### Slot declarations

`slot-status` declares the state of every slot as JSON. An empty value keeps the legacy behaviour: the boolean inputs derive the slot states and `disabled-check-reasons` still explains the disabled core checks. A non-empty value switches to the strict mode, where every slot must be declared and the `Z1: Gate` job verifies the declarations against the jobs and steps that actually ran.

```yaml
jobs:
  quality:
    uses: nocoo/base-ci/.github/workflows/quality.yml@BASE_CI_SHA
    with:
      # every implemented slot keeps its switch enabled
      typecheck: true
      lint: true
      unit: true
      security: true
      workflow-lint: true
      l2: true
      package-check: true
      slot-status: >-
        {"S1": {"status": "impl"},
        "S2": {"status": "impl"},
        "S3": {"status": "impl"},
        "G1": {"status": "impl"},
        "G2": {"status": "impl"},
        "B1": {"status": "todo", "reason": "build output is not split yet"},
        "L1": {"status": "impl"},
        "L2": {"status": "na", "reason": "not a Worker repository"},
        "L3": {"status": "impl"},
        "L4": {"status": "na", "reason": "no user journeys"},
        "P1": {"status": "impl"},
        "Z1": {"status": "impl"}}
```

`slot-status` is a declaration only. It never turns a check on: every `impl` slot still needs its boolean input (`typecheck`, `lint`, `unit`, `security`, `workflow-lint`, `build`, `worker`, `l2`, `l3`, `package-check`) enabled, and every `na` / `todo` slot needs its input left off.

`workflow-lint-required-workflow` holds a single reusable workflow reference. The S3 job only checks that some `uses:` starts with that value plus `@`, so one `quality.yml` call cannot require two reusable workflows at once; multi-value support is a follow-up.

`na` and `todo` need a non-empty reason. `impl` must match reality: the slot has to be enabled, run and report the same `tested-sha` as every other implemented slot. The full rules, the old input mapping and the migration steps live in the [slot standard](slots.md).

v2026.13 aligns check suffixes with the System0 skill (`S1: Types`, `L3: Integration`, `L4: E2E`, …). See [CHANGELOG](../CHANGELOG.md) and [slots.md](slots.md) for the v1 → System0 mapping. Release source proof also requires `quality / Z1: Gate` on the proven SHA (configurable via `release-source` inputs).

GitHub prefixes the required check name with the caller job, so the displayed name depends on how the consumer calls the workflow. The prefix is the caller job's display name: its `name:` when set, otherwise its job key. Keep the caller job key `quality` and either omit `jobs.quality.name` or set it exactly to `quality`, otherwise the prefix changes (for example `CI / Z1: Gate`). The workflow `name:` is only a UI grouping and is not part of the check name. Upgrade first, read the real name from a CI run, and only then update branch protection — do not guess it. Requiring only `quality / Z1: Gate` is enough: the gate already verifies the declarations, the enabled slots and their tested SHA. `Z1: Gate` on its own is the job title, not the check name that branch protection accepts.

## Runtime and installation policy

| Setting | Contract |
| --- | --- |
| `package-manager` / `runtime` | `bun`, `npm`, `pnpm`; `test-job` also accepts `none` |
| `runtime-version` | An exact package manager version, including the patch |
| `node-version` | An exact Node version; independent of the package manager version |
| Runtime resolution | Explicit input, project version metadata, then the pinned default |
| Defaults | Bun 1.4.2, Node 26.12.1, npm 11.19.1, pnpm 10.34.5 |
| `install-policy: blocked` | Frozen install with lifecycle scripts disabled |
| `install-policy: trusted` | Bun only; every installed directory must declare `trustedDependencies` explicitly |
| `install-policy: project` | Frozen install using the project's lifecycle policy |
| `working-directory` | Command and primary install directory, relative to the repository root |
| `extra-install-dirs` | Additional frozen installs, always relative to the repository root |

The installer verifies the actual package manager version in every install directory. Explicit pnpm versions cannot silently switch to a different `packageManager` value. Every install requires a committed lockfile; an absent lockfile is a configuration error. Paths cannot escape the checkout through traversal or symlinks.

Existing applications may deliberately pin earlier supported versions, such as Bun 1.2.15 or a Node LTS release. Updating the shared workflow reference does not require changing those application runtimes.

### Install retries

`setup-js` performs exactly one frozen install per directory (`bun install --frozen-lockfile`, `npm ci` or `pnpm install --frozen-lockfile`) and does not retry it, so a flaky registry fetch fails the whole slot job.

- `env-json` values such as `NPM_CONFIG_FETCH_RETRIES`, `NPM_CONFIG_FETCH_RETRY_MINTIMEOUT`, `NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT`, `NPM_CONFIG_FETCH_TIMEOUT` and `NPM_CONFIG_MAXSOCKETS` (his.fm) only reach the steps that run after `configure-env`. In `quality.yml` the `configure-env` step runs **after** `setup-js`, so those variables do **not** affect the first install — they apply to later commands only. This is a current limitation, not a working mitigation.
- The install-side workaround today is the project `.npmrc`, which npm reads during `npm ci`, for example `fetch-retries=10`, `fetch-retry-mintimeout=20000`, `fetch-retry-maxtimeout=120000` and `fetch-timeout=300000`.
- A built-in retry in `setup-js`, or an input that is applied before the install, is a follow-up and is not implemented yet.

## Native jobs and browser tests

```yaml
jobs:
  offline:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, macos-latest]
        python: ['3.11', '3.14']
    uses: nocoo/base-ci/.github/workflows/test-job.yml@BASE_CI_SHA
    with:
      runner: ${{ matrix.os }}
      runtime: none
      python-version: ${{ matrix.python }}
      pre-command: |
        python -m venv --copies .venv
        .venv/bin/python -m pip install -r requirements.txt
      command: .venv/bin/python -I -B tests/run.py
```

With `runtime: none`, Node or Python can be selected without installing JS packages. Swift, Rust and Go projects can retain their platform/toolchain steps and reuse the [setup-js composite](../.github/actions/setup-js/action.yml) where needed.

`quality.yml` runs every slot on `ubuntu-latest` and has no OS matrix. A repository that needs macOS runners for its slot jobs uses the native pattern in the [slot standard](slots.md): a repo-local `on: workflow_call` workflow whose slot jobs are named exactly `<ID>: <Name>`, called by a job whose key is `quality` (with no `name:`, or a `name:` of exactly `quality`), with a repo-local `Z1: Gate` that needs every slot job. Do not nest `quality.yml` or `test-job.yml` for those jobs: nesting adds a runtime suffix and a duplicated prefix to the check names.

Test jobs configure the environment and run `pre-command` before browser installation. `browser-working-directory` chooses the package containing Playwright; `quality.yml` exposes this as `l4-browser-directory`. Set `l4-artifact-name` and `l4-artifact-path` (or the deprecated `l3-artifact-*` aliases) to preserve project test evidence.

Pass public environment values through `env-json`. Pass only the named test credentials a job needs through the `test-env-json` secret. Values are validated and individually masked; multiline strings are preserved. Do not serialize the entire `secrets` context into a test environment. Caller-level `env` is not automatically inherited by a reusable workflow.

## Security

The shared scanner installs Gitleaks 8.30.1 and OSV Scanner 2.5.1 from versioned release assets with verified SHA-256 checksums. `lockfiles` accepts multiple paths relative to `working-directory`; every declared file must exist. Project scanner configurations and reports stay in the consumer repository.

`scan-history: true` fetches and scans the full Git history. The default scans the checked out directory. Projects with stronger or specialized security gates can run them through `security-command`, with the built-in scans switched off explicitly and their original Git range, configuration and reports preserved.

Inside `quality.yml` the security gate runs as two jobs: `G1: Secret Scan` (gitleaks) and `G2: Dependency Vulnerabilities` (OSV). The legacy `security: true` input still enables both. A custom `security-command` runs once, in the G1 job, and the G2 job only scans lockfiles. The split costs one extra runner job; both jobs install the scanners.

### Thin composite actions (`S3`, `G1`, `G2`, `L4`, `Z1`)

Repositories with custom or native slot workflows (such as macOS or non-JS repos that cannot use `quality.yml` directly) can compose the thin composite actions individually, pinned to the full 40-character provider SHA:

| Action | Slot | Pinned tool | Inputs |
| --- | --- | --- | --- |
| [lint-workflows](../.github/actions/lint-workflows/action.yml) | `S3: Workflow` | `actionlint` `1.7.12` | `files` (default `''`), `required-reusable-workflow` (default `''`) |
| [scan-secrets](../.github/actions/scan-secrets/action.yml) | `G1: Secrets` | `gitleaks` `8.30.1` | `working-directory` (`.`), `config` (auto-detects `.gitleaks.toml`), `ignore-path` (auto-detects `.gitleaksignore`) |
| [scan-dependencies](../.github/actions/scan-dependencies/action.yml) | `G2: Dependencies` | `osv-scanner` `2.5.1` | `lockfiles` (required, comma/newline-separated), `working-directory` (`.`), `config` (auto-detects `osv-scanner.toml`) |
| [setup-playwright](../.github/actions/setup-playwright/action.yml) | `L4: E2E` | `actions/cache` `v6.1.0` | `working-directory` (`.`), `package-manager` (`bun`), `browsers` (`chromium`), `install-deps` (`auto`), `cache` (`true`) |
| [z1-gate](../.github/actions/z1-gate/action.yml) | `Z1: Gate` | Checkout-free Python 3 | `needs-json` (required), `expected-sha` (required), `required-jobs` (required), `skipped-jobs`, `no-sha-jobs`, `allow-extra-needs` (`false`), `title` (`Z1: Gate`) |

`lint-workflows` runs `actionlint -shellcheck= -pyflakes=` without `yamllint` or `setup-js` and verifies that every external `uses:` reference (ignoring `./...`) pins a full 40-hex commit SHA. `scan-secrets` installs only `gitleaks` and runs `gitleaks dir . --no-banner --redact --log-level error`. `scan-dependencies` installs only `osv-scanner`, checks every listed lockfile exists, and runs a single batched `osv-scanner scan`. `setup-playwright` normalizes `PLAYWRIGHT_BROWSERS_PATH` (`~/.cache/ms-playwright` when unset), caches browsers by OS, resolved Playwright version, and sorted browser key, and controls Linux OS shared-library installation via `install-deps`: `auto` (default; `true` is treated as `auto`) installs browsers without `--with-deps` on cache miss and runs `ldd` across cached/installed browser binaries, skipping `apt-get install-deps` when all shared libraries exist on the runner and falling back to `install-deps` if any library is missing or no browser binaries are found; `force` always runs single-pass `install --with-deps` / `install-deps`; `false` skips OS dependencies. `z1-gate` requires no `actions/checkout`, checks required/skipped jobs and matching `tested-sha` outputs, rejects undeclared `needs` by default, and writes a Markdown status table to `$GITHUB_STEP_SUMMARY`.

## Unified `pipeline.yml` (`D1`–`D5`, same-run quality-gated)

As of `v2026.21`, consumers use a single `.github/workflows/pipeline.yml` (`name: Pipeline`) that runs `quality` (`S1`–`Z1`) first and gates `deploy` (`D1`–`D5`) behind `needs: [quality]`, `refs/heads/main`, and GitHub Environment branch protection—so `pull_request` runs never deploy and `deploy` skipping on PRs never blocks `quality / Z1: Gate`.

```yaml
name: Pipeline

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
    inputs:
      deploy:
        description: Deploy after quality gate passes
        type: boolean
        default: false

permissions:
  contents: read

jobs:
  quality:
    uses: ./.github/workflows/quality-slots.yml

  deploy:
    needs: [quality]
    if: >-
      (github.event_name == 'push' && github.ref == 'refs/heads/main') ||
      (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.deploy == true)
    uses: nocoo/base-ci/.github/workflows/deploy-worker.yml@BASE_CI_SHA
    with:
      runtime-version: '1.4.2'
      artifact-name: b1-dist
      d1-migrations: true
      d1-databases: app-db
      verify-command: curl --fail --silent --show-error https://example.com/api/live
    secrets: inherit
```

## Worker releases (`deploy-worker.yml`)

Prefer `artifact-name` (and optional `artifact-path` / `artifact-unpack-command`) so `D2: Artifact` consumes the same-run `B1` output directly without re-running `build-command`. Pass `sparse-checkout` on heavy-asset repositories to trim `D1` checkout. `verify-command` is mandatory (`D5: Verify`). `deploy-cli` defaults to `wrangler` (`wrangler-version: lockfile`); `cf` projects set `deploy-cli: cf`, pinned `cf-version`, `working-directory`, and database UUIDs in `d1-databases`. Use `deploy-env` (`KEY=VALUE`) and `deploy-secret-name` + `DEPLOY_SECRET` when a custom script needs non-Cloudflare configuration vars.

## Docker releases (`deploy-docker.yml`)

`docker-manifest` normalizes each entry in `images` with `cacheScope` (`<repo>-<service>` by default or explicit `cache-scope`), matching CI `P1`'s `type=gha,scope=...` BuildKit cache. Set `deploy-over-ssh: false` for GHCR push-only repositories (`D1` -> `D2` + registry `D5`); keep the default `deploy-over-ssh: true` with `deploy-directory`, `remote-verify-command`, and `verify-command` (plus optional `tailscale: true`) for SSH Compose `@sha256` deployments.

## GitHub Pages releases (`deploy-pages.yml`)

Use `deploy-pages.yml` on `main` push (no tag/release gate) with `artifact-name`, `artifact-path` / `source-path` (optional `prepare-command` and `node-version`), and `verify-url` / `verify-command` for `D5: Verify`. Requires `pages: write` and `id-token: write` on the calling workflow or job.

## Verification and upgrades

Four workflows enforce the provider: syntax and installation policy, real quality/test/scanner fixtures, SSH action behavior, and release-source/manifest contracts. The self-tests cover both slot paths: the legacy boolean-derived path and the strict `slot-status` path. Fixtures include Linux/macOS, Python, npm, pnpm, an older supported Bun and the current Bun. Release source validation has also been exercised against real consumer CI runs. Production end-to-end evidence comes from consumer Release runs.

The SSH self-test drives the runner's own sshd. OpenSSH ≥ 9.8 enables `PerSourcePenalties` by default, so the test writes `/etc/ssh/sshd_config.d/99-self-test.conf` with `PerSourcePenalties no` and `MaxStartups 100:30:100` (validated with `sshd -t`, confirmed with `sshd -T`, with fallbacks for daemons that lack the option) and then re-probes the daemon with repeated host-key scans before running the cases. Without it, `ssh-keyscan` penalizes the runner's own source address and sshd drops the later connections.

For a provider update: change pinned tools once, run provider self-tests, migrate representative JS/native/Worker/Docker consumers, and create an immutable release. Consumers then update their full SHA and run their own checks. Keep application runtime upgrades separate when compatibility requires it. Manual package publication must use an existing intended version/tag; a successful YAML check is not evidence that a package was published.
