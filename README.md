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
