# base-ci

Reusable GitHub Actions workflows and composite actions (Python, JavaScript, shell) for quality gates, native jobs, security scans, and verified releases.
Docs: [README.md](README.md) · [Workflows](docs/workflows.md) · [Slots](docs/slots.md) · [SSH Deploy](.github/actions/ssh-deploy/README.md) · [Retrospective](Retrospective.md)

## Commands

Run from repo root with Node.js and Python 3 (no root package install or bundler; CI pins Node 26.12.1 and `actionlint` 1.7.12).

```sh
actionlint -shellcheck= -pyflakes=
node --test .github/actions/docker-manifest/index.test.mjs
node --test .github/actions/release-source/resolve.test.mjs .github/actions/release-source/workflow-contract.test.mjs
node --test .github/slots/quality.workflow-contract.test.mjs
node --test .github/slots/internal-pin.test.mjs
python3 -m unittest discover -s .github/actions/setup-js -p 'test_*.py'
python3 -m unittest discover -s .github/actions/configure-env -p 'test_*.py'
python3 -m unittest discover -s .github/actions/resolve-locked-wrangler -p 'test_*.py'
python3 -m unittest discover -s .github/slots -p 'test_*.py'
git diff --check
```

Package-manager/lifecycle (`self-test.yml`) and SSH (`self-test-ssh-deploy.yml`) smoke suites run on disposable GitHub runners; never run their runner setup against the daily workstation.

## Invariants

- Pin consumers and internal action refs to full immutable SHAs (`.github/internal-provider-pin.txt`); relative internal paths resolve inside consumer checkouts and are unsafe.
- Every enabled quality job must succeed and report the same checkout SHA before emitting `tested-sha`; missing requested artifacts fail.
- `slot-status` contract: `impl` requires the slot enabled, passing, and matching checkout SHA; `na`/`todo` require it off with a truthful reason; empty `slot-status` keeps legacy boolean derivation.
- `Z1: Gate` fails on unknown slots, illegal statuses, missing reasons, enabled-but-skipped slots, conflicting alias inputs, and SHA mismatches ([docs/slots.md](docs/slots.md)).
- Pin exact runtimes and frozen installs while preserving consumer lifecycle policy; `extra-install-dirs` are repo-root relative and must not escape via traversal or symlinks.
- Fixture lockfiles under `.github/fixtures/` must come from real supported package managers with no workstation registry proxy.
- Map only named test credentials into CI; production credentials belong to deployment jobs and exact GitHub environments—never map `toJSON(secrets)` wholesale.
- Release proof validates API run/tag, repo, workflow, branch, event, exact SHA, and `quality / Z1: Gate`; reject PR/fork, stale, or mismatched evidence—never fall back to latest green or `github.sha`.
- Production concurrency never cancels active deploys; migrations and deploys run only after source proof and freshness checks.
- Worker releases rebuild verified source (locked Wrangler or `cf`); artifact promotion retains project-owned identity and digest checks.
- Docker deploys use a complete same-SHA image digest manifest, preserving server Compose settings, serial pulls, and caller health checks.
- Keep platform-specific deployment logic in small project adapters; require a second concrete consumer before abstracting, and never weaken tests, coverage, or security to make adoption green.
- Publish immutable `v2026.N` tags only after provider self-tests and representative JS/native/Worker/Docker consumer CI/release validation; sync internal pins via `node .github/scripts/sync-provider-pin.mjs`.
- Keep runtime upgrades separate from workflow-ref updates; historical moving `v2026` is not an upgrade policy. New integrations use `quality.yml`; `bun-quality.yml` stays only for existing pinned consumers.
- Project operators own deployment approval, production health checks, and package publication; passing YAML proves neither deployment nor publication.

## Quality & Local Gates

Provides the reusable `system1-quality` slot gate in `.github/workflows/quality.yml` (wiring in [docs/slots.md](docs/slots.md)) and verifies itself via `.github/workflows/self-test*.yml`. Status vocabulary: `enforced`, `planned`, `manual`, `N/A`; gaps record current enforcement, not a lower bar.

- **Workflows & contracts (`enforced`)**: `self-test.yml`, `self-test-quality.yml` (legacy & strict `Z1: Gate`, native/PM matrix, L4 artifacts), `self-test-release.yml`, and `self-test-ssh-deploy.yml`.
- **Security G1/G2 (`enforced`)**: checkout secret scan (`G1`) and lockfile OSV scan (`G2`) run inlined in `quality.yml` and standalone via `security.yml` under `self-test-quality.yml`.
- **Helper static / L1 coverage (`planned`)**: Node and Python behavioral tests run in `self-test.yml` and `self-test-release.yml`; helper lint/types and four-metric ≥95% coverage thresholds are not enforced yet.
- **Local hooks (`planned`)**: no repo hooks configured; target check-only pre-commit (staged-index L1, <30s) and pre-push (push-ref integration+G2, <3min). Never bypass hooks with `--no-verify`.
- **Runner isolation (`planned`)**: CI uses disposable GitHub-hosted runners with no prod writes; local fixture isolation guards remain incomplete.
- **Owned HTTP API / P1 package (`N/A`)**: no application HTTP API or published package; fixtures exercise reusable workflows directly.
- **Docs & slot parity (`manual`)**: workflow inputs match behavior; [docs/slots.md](docs/slots.md) stays implementation-only while `system1-quality` is the canonical slot SoT.

## Retrospective

Record incident narratives in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above, cross-project lessons to global rules, and deterministic checks to tests or hooks.
