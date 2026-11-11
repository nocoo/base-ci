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
| [deploy-worker.yml](../.github/workflows/deploy-worker.yml) | Rebuild a proven CI commit, optionally migrate D1, deploy locked Wrangler or cf and verify production |
| [deploy-docker.yml](../.github/workflows/deploy-docker.yml) | Build one or more GHCR images from a proven CI commit and deploy their exact digests through Docker Compose over SSH |

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

## Release source proof

Both deployment workflows use [release-source](../.github/actions/release-source/action.yml). It validates GitHub API responses for the selected run: repository and head repository, workflow path and name, branch, event, completion, conclusion and exact SHA. List API filters are followed by a direct GET of the selected run.

| Input | Meaning |
| --- | --- |
| `expected-workflow-path` | Canonical CI file, normally `.github/workflows/ci.yml` |
| `expected-workflow-name` | Canonical CI name, normally `CI` |
| `expected-branch` | Expected CI branch, normally `main`; pass the tag name when proving tag CI |
| `source-run-id` | Explicit successful CI run ID, including manual deployments |
| `tag` | Optional tag, resolved to a commit and checked against the proven CI run |
| `required-quality-check` | Check-run name that must succeed on the proven SHA (default `quality / Z1: Gate`) |
| `require-quality-check` | When true, missing or failed quality evidence fails the deploy |

`deploy-worker.yml` and `deploy-docker.yml` expose the same defaults and forward both fields to `release-source`.

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
      wrangler-version: lockfile
      environment: Production
      build-command: bun run build
      d1-migrations: true
      d1-databases: app-db
      verify-command: curl --fail --silent --show-error https://example.com/api/live
    secrets: inherit
```

`deploy-cli` defaults to `wrangler`; existing callers keep their named D1 databases, `--remote`, optional `wrangler-config` / `wrangler-working-directory`, and default `deploy` command. `wrangler-version` defaults to `lockfile`, which reads the exact version from `bun.lock`, `package-lock.json`, `pnpm-lock.yaml`, and/or `yarn.lock` under `working-directory` and requires every present lockfile to agree. Omit the input or set `wrangler-version: lockfile` to stop hand-pinning Wrangler on every bump. An explicit semver pin remains supported and unchanged when shared steps use Wrangler.

For a cf-only project, replace the Wrangler inputs with:

```yaml
with:
  source-run-id: ${{ format('{0}', github.event.workflow_run.id) }}
  package-manager: npm
  node-version: '26.12.1'
  deploy-cli: cf
  cf-version: '1.0.0-beta.12'
  build-command: npm run build
  d1-migrations: true
  d1-databases: 00000000-1234-5678-abcd-000000000001
  verify-command: curl --fail --silent --show-error https://example.com/api/live
```

Replace the example UUID with the production database ID. Pin `cf` in the project's dependency manifest and lockfile and commit `cloudflare.config.ts`. `cf-version` must exactly match the local binary, including prerelease suffixes. Shared cf steps never install, locate or invoke Wrangler. `working-directory` selects the cf project; Wrangler-specific path inputs are rejected for cf.

The build command must generate `.cloudflare/output` from the proven checkout. The default cf deployment is `cf deploy --prebuilt --mode production`: it does not rebuild or run automatic configuration. Build and deploy modes must match. Set `deploy-command: deploy --prebuilt --mode staging` for a build explicitly created with staging mode; the GitHub `environment` name does not set the cf mode. See [cf in CI](https://developers.cloudflare.com/cf/ci/) and [prebuilt deployment](https://developers.cloudflare.com/cf/projects/#deploy-a-prebuilt-build).

For cf, `d1-databases` accepts database UUIDs, not names or bindings, and migrations are remote without a `--remote` flag. The default migration directory is `./migrations`. Use `d1-command: d1 migrations apply UUID --dir drizzle --pattern */migration.sql --table custom` for a custom layout; it replaces the database loop and is passed to the selected local CLI. `deploy-command` and `d1-command` are whitespace-separated CLI arguments, not shell scripts; globs remain literal. Use a project script for shell quoting or compound commands. cf does not read Wrangler migration settings; see the [migration reference](https://developers.cloudflare.com/cf/wrangler/reference/).

`deploy-script` invokes an existing complete project release command instead of the shared deploy command. With shared `d1-migrations: false` (the default), neither CLI version nor binary is required or checked; the script owns its toolchain. With shared migrations enabled, the selected CLI and its exact version are still required for migrations, followed by the project script. A deployment holds a non-cancelling lock for its production environment.

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

### Tailscale before SSH (optional)

When the deploy host is reachable only on a tailnet (for example after blocking public SSH from GitHub-hosted runners), opt in with `tailscale: true`. The deploy job joins the tailnet using [Tailscale workload identity federation](https://tailscale.com/docs/integrations/github/github-action) (`tailscale/github-action@v4`, pinned to a full commit SHA in `deploy-docker.yml`), then uses the same OpenSSH + deploy key path as today. Tailscale SSH (`--ssh`) is not enabled.

Out of band (Tailscale admin console): create a federated identity with `auth_keys` scope, define tags (for example `tag:ci`) and ACL rules that allow `tag:ci` to reach the deploy host on the SSH port. Map the federated identity **client ID** and **audience** into GitHub secrets named `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE` (Tailscale’s documented names; federation uses `audience`, not `TS_OAUTH_SECRET`).

Pass those secrets through `workflow_call` and set `VPS_HOST` to the host’s Tailscale IP or MagicDNS short name (for example `100.101.0.2` or `jp2`). Default ephemeral node tags are `tag:ci` (`tailscale-tags` input). Optional `tailscale-ping` is a comma-separated peer list; when empty, the workflow pings `VPS_HOST` after join.

`VPS_KNOWN_HOSTS` should include the key for the hostname or IP you pass as `VPS_HOST`. Refresh with `ssh-keyscan -p "$VPS_PORT" -H "$VPS_HOST"` from a machine that can reach the host, then update the secret.

Example caller fragment (bump `BASE_CI_SHA` after upgrading base-ci):

```yaml
jobs:
  release:
    uses: nocoo/base-ci/.github/workflows/deploy-docker.yml@BASE_CI_SHA
    secrets:
      VPS_HOST: ${{ secrets.VPS_HOST }}
      VPS_USER: ${{ secrets.VPS_USER }}
      VPS_SSH_KEY: ${{ secrets.VPS_SSH_KEY }}
      VPS_PORT: ${{ secrets.VPS_PORT }}
      VPS_KNOWN_HOSTS: ${{ secrets.VPS_KNOWN_HOSTS }}
      GHCR_PULL_USER: ${{ secrets.GHCR_PULL_USER }}
      GHCR_PULL_TOKEN: ${{ secrets.GHCR_PULL_TOKEN }}
      TS_OAUTH_CLIENT_ID: ${{ secrets.TS_OAUTH_CLIENT_ID }}
      TS_AUDIENCE: ${{ secrets.TS_AUDIENCE }}
    with:
      tailscale: true
      # tailscale-tags: tag:ci
      # tailscale-ping: jp2,100.101.0.2
      environment: app / production
      images: '[...]'
      deploy-directory: /opt/app
      remote-verify-command: ./verify-containers.sh
      verify-command: ./scripts/verify-production.sh
```

Callers that do not set `tailscale: true` behave as before and do not need Tailscale secrets. The deploy job requests `id-token: write` so federation can obtain a GitHub OIDC token when Tailscale is enabled.

Every image has the proven source SHA as its tag and OCI revision. A release manifest must contain exactly one valid digest for every requested image/service, all from that same source. On the server, the workflow reads the actual Compose configuration, overrides only the selected images with digests, pulls them serially and recreates those services. It preserves other service settings and project health checks. Successful manifests are recorded in `.base-ci-releases/<SHA>.json`; a temporary effective Compose file is removed after use. The server needs Python 3 and Docker Compose v2.

## Verification and upgrades

Four workflows enforce the provider: syntax and installation policy, real quality/test/scanner fixtures, SSH action behavior, and release-source/manifest contracts. The self-tests cover both slot paths: the legacy boolean-derived path and the strict `slot-status` path. Fixtures include Linux/macOS, Python, npm, pnpm, an older supported Bun and the current Bun. Release source validation has also been exercised against real consumer CI runs. Production end-to-end evidence comes from consumer Release runs.

For a provider update: change pinned tools once, run provider self-tests, migrate representative JS/native/Worker/Docker consumers, and create an immutable release. Consumers then update their full SHA and run their own checks. Keep application runtime upgrades separate when compatibility requires it. Manual package publication must use an existing intended version/tag; a successful YAML check is not evidence that a package was published.
