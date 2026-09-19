# Workflow integration guide

Shared GitHub Actions workflows for nocoo projects: JavaScript quality checks, native test jobs, security scans, and releases that prove which commit passed CI.

Consumers keep their triggers, project commands, deployment environment and a few switches. Package installation, runtime setup, scanning, artifact handling and release source validation live here. Pin every reference to the full commit SHA from a reviewed release. `BASE_CI_SHA` in the examples is a placeholder that must be replaced with a literal 40-character SHA.

## Choose a workflow

| Workflow | Use it for |
| --- | --- |
| [quality.yml](../.github/workflows/quality.yml) | Bun, npm or pnpm typecheck, lint, unit tests and security; optional build, L2, L3, Worker and package checks |
| [test-job.yml](../.github/workflows/test-job.yml) | One command with shared setup, a caller-owned runner matrix, Python or Node without JS dependencies, and optional browser/report support |
| [security.yml](../.github/workflows/security.yml) | Multiple lockfiles, directory or full-history secret scanning, or an existing project security gate |
| [workflow-lint.yml](../.github/workflows/workflow-lint.yml) | Actionlint, immutable base-ci references, optional required release template and yamllint |
| [deploy-worker.yml](../.github/workflows/deploy-worker.yml) | Rebuild a proven CI commit, optionally migrate D1, deploy locked Wrangler and verify production |
| [deploy-docker.yml](../.github/workflows/deploy-docker.yml) | Build one or more GHCR images from a proven CI commit and deploy their exact digests through Docker Compose over SSH |

The workflow files define the complete input and output contracts. `bun-quality.yml` is the older string-switch interface; new migrations use `quality.yml`. Historical behavior remains available through immutable commits and the `v2026.1`–`v2026.6` tags. The old moving `v2026` alias is not an upgrade policy.

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

`coverage-path` is explicitly opt-in. It must point to a real report, relative to the repository root. A requested missing report fails the job. Build artifacts use `artifact-name` and `artifact-paths`. The successful aggregate emits `tested-sha` only after every enabled job succeeds and reports the same checked out commit.

## Runtime and installation policy

| Setting | Contract |
| --- | --- |
| `package-manager` / `runtime` | `bun`, `npm`, `pnpm`; `test-job` also accepts `none` |
| `runtime-version` | An exact package manager version, including the patch |
| `node-version` | An exact Node version; independent of the package manager version |
| Runtime resolution | Explicit input, project version metadata, then the pinned default |
| Defaults | Bun 1.4.2, Node 26.8.1, npm 11.19.1, pnpm 10.34.5 |
| `install-policy: blocked` | Frozen install with lifecycle scripts disabled |
| `install-policy: trusted` | Bun only; every installed directory must declare `trustedDependencies` explicitly |
| `install-policy: project` | Frozen install using the project's lifecycle policy |
| `working-directory` | Command and primary install directory, relative to the repository root |
| `extra-install-dirs` | Additional frozen installs, always relative to the repository root |

The installer verifies the actual package manager version in every install directory. Explicit pnpm versions cannot silently switch to a different `packageManager` value. Every install requires a committed lockfile; an absent lockfile is a configuration error. Paths cannot escape the checkout through traversal or symlinks.

Existing applications may deliberately pin earlier supported versions, such as Bun 1.2.15 or a Node LTS release. Updating the shared workflow reference does not require changing those application runtimes.

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

Test jobs configure the environment and run `pre-command` before browser installation. `browser-working-directory` chooses the package containing Playwright; `quality.yml` exposes this as `l3-browser-directory`. Set `artifact-name`, `artifact-path` and `artifact-retention-days` to preserve project test evidence.

Pass public environment values through `env-json`. Pass only the named test credentials a job needs through the `test-env-json` secret. Values are validated and individually masked; multiline strings are preserved. Do not serialize the entire `secrets` context into a test environment. Caller-level `env` is not automatically inherited by a reusable workflow.

## Security

The shared scanner installs Gitleaks 8.30.1 and OSV Scanner 2.5.1 from versioned release assets with verified SHA-256 checksums. `lockfiles` accepts multiple paths relative to `working-directory`; every declared file must exist. Project scanner configurations and reports stay in the consumer repository.

`scan-history: true` fetches and scans the full Git history. The default scans the checked out directory. Projects with stronger or specialized security gates can run them through `security-command`, with the built-in scans switched off explicitly and their original Git range, configuration and reports preserved.

## Release source proof

Both deployment workflows use [release-source](../.github/actions/release-source/action.yml). It validates GitHub API responses for the selected run: repository and head repository, workflow path and name, branch, event, completion, conclusion and exact SHA. List API filters are followed by a direct GET of the selected run.

| Input | Meaning |
| --- | --- |
| `expected-workflow-path` | Canonical CI file, normally `.github/workflows/ci.yml` |
| `expected-workflow-name` | Canonical CI name, normally `CI` |
| `expected-branch` | Expected CI branch, normally `main`; pass the tag name when proving tag CI |
| `source-run-id` | Explicit successful CI run ID, including manual deployments |
| `tag` | Optional tag, resolved to a commit and checked against the proven CI run |

There is no fallback to `github.sha` or an unrelated latest green run. PR and fork evidence is rejected. Continuous deployments check the branch tip again immediately before migration/deployment. Tagged releases prove the tag's exact commit. The source action and Worker template additionally support an expected `source-sha` and optional tag/package-version matching.

The source action emits `target-sha` and `source-run-id`. A scheduled or `release` caller may present valid push-CI evidence; its trigger does not itself prove CI success.

## Worker releases

```yaml
name: Release
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success'
    permissions:
      contents: read
      actions: read
    uses: nocoo/base-ci/.github/workflows/deploy-worker.yml@BASE_CI_SHA
    with:
      source-run-id: ${{ format('{0}', github.event.workflow_run.id) }}
      runtime-version: '1.4.2'
      wrangler-version: '4.131.1'
      environment: Production
      build-command: bun run build
      d1-migrations: true
      d1-databases: app-db
      verify-command: curl --fail --silent --show-error https://example.com/api/live
    secrets: inherit
```

`wrangler-version` must equal the frozen local dependency's actual version. `deploy-command` is a Wrangler subcommand. `deploy-script` instead invokes an existing complete project release command, such as GeekHub's production guard, migrations, build and deployment. A deployment holds a non-cancelling lock for its production environment.

GitHub environment names are exact and case-sensitive. The called deployment job selects the environment and reads its `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. CI jobs do not need production deployment credentials.

This workflow rebuilds the proven source. Projects promoting already tested artifacts keep their artifact identity/digest validation in a small adapter using the shared source and setup actions. A warning-only artifact download is not a replacement for that validation.

## Docker releases

Use the same trigger and source inputs with `deploy-docker.yml`, then provide:

```yaml
with:
  source-run-id: ${{ format('{0}', github.event.workflow_run.id) }}
  environment: app / production
  images: '[{"image":"ghcr.io/nocoo/app-web","service":"web","build-args":"APP=web"},{"image":"ghcr.io/nocoo/app-admin","service":"admin","build-args":"APP=admin"}]'
  deploy-directory: /opt/app
  remote-verify-command: ./verify-containers.sh
  verify-command: ./scripts/verify-production.sh
```

The caller needs `contents: read`, `actions: read` and `packages: write`. Credentials are `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, optional `VPS_PORT`/`VPS_KNOWN_HOSTS`, and `GHCR_PULL_USER`/`GHCR_PULL_TOKEN`. `BUILD_ARGS` carries additional caller build arguments.

Every image has the proven source SHA as its tag and OCI revision. A release manifest must contain exactly one valid digest for every requested image/service, all from that same source. On the server, the workflow reads the actual Compose configuration, overrides only the selected images with digests, pulls them serially and recreates those services. It preserves other service settings and project health checks. Successful manifests are recorded in `.base-ci-releases/<SHA>.json`; a temporary effective Compose file is removed after use. The server needs Python 3 and Docker Compose v2.

## Verification and upgrades

Four workflows enforce the provider: syntax and installation policy, real quality/test/scanner fixtures, SSH action behavior, and release-source/manifest contracts. Fixtures include Linux/macOS, Python, npm, pnpm, an older supported Bun and the current Bun. Release source validation has also been exercised against real consumer CI runs. Production end-to-end evidence comes from consumer Release runs.

For a provider update: change pinned tools once, run provider self-tests, migrate representative JS/native/Worker/Docker consumers, and create an immutable release. Consumers then update their full SHA and run their own checks. Keep application runtime upgrades separate when compatibility requires it. Manual package publication must use an existing intended version/tag; a successful YAML check is not evidence that a package was published.
