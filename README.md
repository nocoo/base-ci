# base-ci

Reusable GitHub Actions workflows for Bun/TypeScript projects. Implements a 6-dimension quality system.

## Quality Dimensions

| Layer | Name | Description |
|-------|------|-------------|
| L1 | Unit Tests | Unit/component tests with coverage |
| L2 | API E2E | Real HTTP tests against test infrastructure |
| L3 | Browser E2E | Playwright browser automation |
| G1 | Static Analysis | TypeScript type-check + ESLint |
| G2 | Security | Gitleaks (secrets) + OSV-Scanner (dependencies) |
| Worker | Edge Runtime | Cloudflare Worker unit tests |

## Usage

### Basic (L1 + G1 + G2)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  quality:
    uses: nocoo/base-ci/.github/workflows/bun-quality.yml@v2026
    with:
      bun-version: "1.3.11"
    secrets: inherit
```

### With Pre-build Step (Next.js)

```yaml
jobs:
  quality:
    uses: nocoo/base-ci/.github/workflows/bun-quality.yml@v2026
    with:
      bun-version: "1.3.11"
      pre-command: "bun run build --no-lint"
      typecheck-command: "bun x tsc --noEmit"
    secrets: inherit
```

### Full Stack (L1 + L2 + L3 + G1 + G2 + Worker)

For projects with E2E tests requiring secrets (Cloudflare D1, R2, KV, etc.), define local jobs with full secret control:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  # L1 + G1 + G2 from base-ci
  quality:
    uses: nocoo/base-ci/.github/workflows/bun-quality.yml@v2026
    with:
      bun-version: "1.3.11"
      pre-command: "bun run build --no-lint"
      # Disable built-in L2/L3/Worker (define locally for secret control)
      enable-l2: "false"
      enable-l3: "false"
      enable-worker: "false"
    secrets: inherit

  # L2: API E2E (local job for full secret control)
  api-e2e:
    name: "L2 API E2E"
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      # D1 test database
      CLOUDFLARE_D1_DATABASE_ID: ${{ secrets.CLOUDFLARE_D1_DATABASE_ID }}
      D1_TEST_DATABASE_ID: ${{ secrets.D1_TEST_DATABASE_ID }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      # D1 Worker proxy (test)
      D1_TEST_PROXY_URL: ${{ secrets.D1_TEST_PROXY_URL }}
      D1_TEST_PROXY_SECRET: ${{ secrets.D1_TEST_PROXY_SECRET }}
      # R2 test bucket
      R2_TEST_BUCKET_NAME: ${{ secrets.R2_TEST_BUCKET_NAME }}
      R2_TEST_PUBLIC_DOMAIN: ${{ secrets.R2_TEST_PUBLIC_DOMAIN }}
      R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
      R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
      R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
      # KV test namespace
      KV_TEST_NAMESPACE_ID: ${{ secrets.KV_TEST_NAMESPACE_ID }}
      # Auth
      AUTH_SECRET: ${{ secrets.AUTH_SECRET }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.11"
      - run: bun install --frozen-lockfile
      - run: bun run build --no-lint
      - run: bun run test:api

  # L3: Browser E2E (local job for full secret control)
  browser-e2e:
    name: "L3 Browser E2E"
    runs-on: ubuntu-latest
    timeout-minutes: 25
    env:
      # Same secrets as api-e2e...
      CLOUDFLARE_D1_DATABASE_ID: ${{ secrets.CLOUDFLARE_D1_DATABASE_ID }}
      D1_TEST_DATABASE_ID: ${{ secrets.D1_TEST_DATABASE_ID }}
      # ... (see api-e2e for full list)
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.11"
      - run: bun install --frozen-lockfile
      - run: bunx playwright install --with-deps chromium
      - run: bun run build --no-lint
      - run: bun run test:e2e:pw

  # Worker: Cloudflare Worker tests
  worker-tests:
    name: "Worker Tests"
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: worker
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.11"
      - run: bun install --frozen-lockfile
      - run: bun run test
```

## Inputs

### Runtime

| Input | Default | Description |
|-------|---------|-------------|
| `bun-version` | `"latest"` | Bun version (e.g., `"1.3.11"`) |
| `pre-command` | `""` | Setup command before tests (e.g., `"bun run build"`) |
| `ignore-scripts` | `false` | Pass `--ignore-scripts` to every `bun install` step (see **Hardening** below) |
| `extra-install-dirs` | `""` | Comma-separated subdirs that need their own `bun install` (e.g. `"worker"` or `"worker,dashboard"`) |
| `trusted-native-deps` | `""` | Comma-separated packages whose postinstall must still run when `ignore-scripts: true` (native bindings: `better-sqlite3`, `sharp`, etc.). When non-empty, `--ignore-scripts` is NOT forwarded; defense moves to bun's `trustedDependencies` whitelist — see **Native dependencies + ignore-scripts** below |

### L1: Unit Tests

| Input | Default | Description |
|-------|---------|-------------|
| `test-command` | `"bun run test:unit:coverage"` | Unit test command |
| `upload-coverage` | `"true"` | Upload coverage artifact |
| `coverage-path` | `"coverage"` | Coverage output directory |

### G1: Static Analysis

| Input | Default | Description |
|-------|---------|-------------|
| `lint-command` | `"bun run lint"` | Lint command |
| `typecheck-command` | `"bun run typecheck"` | Type-check command |

### G2: Security

| Input | Default | Description |
|-------|---------|-------------|
| `enable-security` | `"true"` | Enable gitleaks + osv-scanner |
| `osv-lockfile` | `"bun.lock"` | Lockfile for osv-scanner |
| `osv-config` | `""` | Path to osv-scanner config |

### L2: API E2E (opt-in)

| Input | Default | Description |
|-------|---------|-------------|
| `enable-l2` | `"false"` | Enable L2 API E2E tests |
| `l2-command` | `"bun run test:api"` | L2 test command |

### L3: Browser E2E (opt-in)

| Input | Default | Description |
|-------|---------|-------------|
| `enable-l3` | `"false"` | Enable L3 Playwright tests |
| `l3-command` | `"bun run test:e2e:pw"` | L3 test command |
| `l3-browser` | `"chromium"` | Browser to install |

### Worker (opt-in)

| Input | Default | Description |
|-------|---------|-------------|
| `enable-worker` | `"false"` | Enable Worker tests |
| `worker-command` | `"bun run test"` | Worker test command |
| `worker-directory` | `"worker"` | Worker project directory |

## Hardening (recommended)

Since v2026.2, `bun-quality.yml` ships two opt-in inputs that harden CI against npm supply-chain attacks (Shai-Hulud-style worms that piggyback on lifecycle scripts):

```yaml
jobs:
  quality:
    uses: nocoo/base-ci/.github/workflows/bun-quality.yml@v2026.2
    with:
      ignore-scripts: true
      extra-install-dirs: "worker"
    secrets: inherit
```

### `ignore-scripts: true`

Forwards `--ignore-scripts` to every `bun install --frozen-lockfile` step **only when `trusted-native-deps` is empty**. In that mode bun drops every lifecycle script — postinstall hooks for compromised packages cannot run, even if a malicious version is pinned in `bun.lock`. Pick this mode when the dependency graph has **no** native packages (or when you have vendored their bindings).

When `trusted-native-deps` is non-empty, `--ignore-scripts` is **not** forwarded; defense moves to bun's `trustedDependencies` whitelist instead — see [Native dependencies + ignore-scripts](#native-dependencies--ignore-scripts) below. The two paths are mutually exclusive because `bun install --ignore-scripts` is a hard switch that overrides `trustedDependencies`, and `bun pm trust` cannot recover scripts that were never queued (verified on bun 1.3.x).

### `extra-install-dirs: "worker"` (or `"worker,dashboard"`)

After the main `bun install`, each job recurses into every comma-separated subdirectory and runs `bun install --frozen-lockfile` there (inheriting the `ignore-scripts` flag). Use for repos with fixed sub-trees that have their own lockfile, like Cloudflare Worker subprojects or standalone dashboards.

The step is a no-op when the input is `""` (default), so this is safe to set globally.

## Native dependencies + ignore-scripts

`bun install --ignore-scripts` is a hard switch: bun drops every lifecycle script entirely instead of queuing it for later. That means **the `bun pm trust` recovery path is unusable on bun** — running `bun pm trust <pkg>` after `bun install --ignore-scripts` reports "0 scripts ran" and exits 1, and native bindings stay missing. This is verified on bun 1.3.x (see [STU-95](https://github.com/nocoo/base-ci) for a minimal repro: `bun add better-sqlite3 --ignore-scripts && bun pm trust better-sqlite3` ⇒ exit 1, binding not built).

The right model for native deps under bun is bun's own `trustedDependencies` whitelist. By default bun runs postinstall scripts **only** for packages listed in the caller repo's `package.json#trustedDependencies` — every other postinstall is blocked. That is exactly the Shai-Hulud defense semantic we want, and it does not need `--ignore-scripts`.

Since v2026.4, `trusted-native-deps` switches `bun-quality.yml` into this mode. When you pass a non-empty list:

1. `--ignore-scripts` is **not** forwarded — bun runs with its default lifecycle policy.
2. Bun consults `package.json#trustedDependencies` and runs postinstall **only** for packages on that list.
3. Every other postinstall (including any malicious lifecycle script in a transitive dep) stays blocked.

To use it, declare the same packages in **both** places — `package.json` for bun, and `trusted-native-deps` for base-ci. The two must stay in sync; the workflow input exists for documentation and as a validation hook for future tooling.

```jsonc
// package.json (caller repo)
{
  "trustedDependencies": ["better-sqlite3", "sharp"]
}
```

```yaml
# .github/workflows/ci.yml (caller repo)
jobs:
  quality:
    uses: nocoo/base-ci/.github/workflows/bun-quality.yml@v2026.4
    with:
      ignore-scripts: true
      trusted-native-deps: "better-sqlite3,sharp"
    secrets: inherit
```

Common entries: `better-sqlite3`, `sharp`, `esbuild`, `unrs-resolver`, `@swc/core`, the Next.js `@next/swc-*` binary. If a native dependency is missing from both lists, builds will fail with a missing-binary error — that is the signal to add it (vetted) to the whitelist.

### When to leave `trusted-native-deps` empty

If your dependency graph genuinely has **no** native packages (or you have vendored every binding), leave `trusted-native-deps: ""` and keep `ignore-scripts: true`. That is the hardest mode: `--ignore-scripts` is forwarded, every lifecycle script is dropped, and `trustedDependencies` is irrelevant. No native-dep recovery path exists in this mode — pick it only when you do not need one.

### Scope limitation

`trusted-native-deps` is a documentation/sync field for the **top-level** install; the actual whitelist lives in the caller's top-level `package.json#trustedDependencies`. Subdirectory installs from `extra-install-dirs` consult their own `package.json#trustedDependencies` independently, so add the same entries there if a native dep lives inside (e.g.) `worker/`.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Parallel Execution                        │
├─────────────────┬─────────────────┬─────────────────────────┤
│ quality-gate    │ api-e2e (L2)    │ browser-e2e (L3)        │
│ (L1+G1+G2)      │ (opt-in)        │ (opt-in)                │
│                 │                 │                          │
│ • Gitleaks      │ • Real HTTP     │ • Playwright            │
│ • TypeScript    │ • Test DB/R2/KV │ • Test DB/R2/KV         │
│ • ESLint        │                 │                          │
│ • Unit tests    │                 │                          │
│ • OSV-Scanner   │                 │                          │
└─────────────────┴─────────────────┴─────────────────────────┘
                            │
                    ┌───────┴───────┐
                    │ worker-tests  │
                    │ (opt-in)      │
                    │               │
                    │ • Vitest      │
                    └───────────────┘
```

All jobs run in **parallel** — no `needs` dependencies. This reduces CI time by ~50% compared to sequential execution.

## Test Isolation

For L2/L3 tests against Cloudflare resources, implement a 4-layer safety system:

1. **Env override**: `D1_TEST_DATABASE_ID` → `CLOUDFLARE_D1_DATABASE_ID`
2. **Inequality check**: `testDbId !== prodDbId`
3. **Defensive guard**: Validation in DB helper functions
4. **Marker table**: `_test_marker` table exists only in test DB

This ensures tests **never** run against production resources.

## Versioning

Use semantic version tags:

```bash
git tag -a v2026 -m "2026 release"
git push origin v2026
```

To update an existing tag:

```bash
git tag -d v2026
git push origin :refs/tags/v2026
git tag -a v2026 -m "2026 release (updated)"
git push origin v2026
```

## License

MIT
