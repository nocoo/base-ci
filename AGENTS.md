# base-ci

Reusable GitHub Actions for quality checks, native jobs, security and verified releases.
Profile: docs-config, with executable Python, JavaScript and shell helpers.
Human overview: [README.md](README.md). Frameworks must not rewrite this file. Maintain this root `AGENTS.md` as the only project handbook; do not create a `CLAUDE.md` alias, copy or import.

## Sources of Truth

This file is the contract; hooks, CI and configuration enforce it. Raise weaker enforcement instead of lowering the contract.

| Fact | Where |
|---|---|
| Human and interface docs | [README.md](README.md), workflow/action input definitions |
| CI slot standard | [docs/slots.md](docs/slots.md): numbering, declarations, Z1 rules, migration |
| Enforcement | `.github/workflows/self-test*.yml`, helper tests under `.github/actions/` and `.github/slots/` |
| Version | Immutable `v2026.N` tags; consumers pin full commit SHAs |
| Machine rules | Global `AGENTS.md` and `rules/` |
| Accidents | [Retrospective.md](Retrospective.md) |

## Project Invariants

- Consumers and internal cross-repository action references use full immutable SHAs. Relative internal action paths resolve inside the consumer checkout and are unsafe substitutes.
- Every enabled quality job must succeed and report the same checkout SHA before the aggregate emits `tested-sha`. Missing requested artifacts fail.
- Slot declarations are a contract. `impl` requires the slot's job or step to be enabled, to succeed and to report the same SHA; `na` and `todo` require the slot to stay off and to carry a truthful reason. `Z1: Gate` fails on unknown slots, illegal statuses, missing reasons, enabled-but-skipped slots and SHA mismatches. An empty `slot-status` keeps the legacy boolean-derived path.
- Pin exact runtimes and frozen installs; preserve the consumer's lifecycle policy. Extra install paths are repository-root relative and must not escape through traversal or symlinks. Fixture locks come from real supported package managers, with no workstation registry proxy.
- Map only named test credentials into CI. Production credentials belong to deployment jobs and exact GitHub environments; never map `toJSON(secrets)` wholesale.
- Release proof validates the selected GitHub API run/tag, repository, workflow, branch, event and exact SHA. Reject PR/fork, stale or mismatched evidence; never fall back to latest green or `github.sha`.
- Production concurrency must not cancel an active deployment. Migrations/deployment follow source proof and freshness checks. Worker releases rebuild verified source; artifact promotion retains project-owned identity/digest checks.
- Docker uses a complete manifest of same-SHA image digests; preserve actual server Compose settings, serial pulls and caller health checks.
- Keep platform-specific deployment behavior in small project adapters. Require a second concrete consumer before adding an abstraction; never weaken tests, coverage or security to make adoption green.

## Stack / Layout

| Location | Purpose |
|---|---|
| `.github/workflows/quality.yml`, `test-job.yml` | Slot-numbered JS gates and portable/native jobs |
| `.github/workflows/security.yml`, `workflow-lint.yml` | Verified scanners, lockfiles, YAML and immutable pins |
| `.github/workflows/deploy-worker.yml`, `deploy-docker.yml` | Proven-source deployment interfaces |
| `.github/actions/setup-js/`, `configure-env/` | Python runtime/install and environment validation |
| `.github/actions/resolve-locked-wrangler/` | Locked Wrangler version resolution for deploy-worker |
| `.github/actions/release-source/`, `docker-manifest/` | JavaScript release proof and manifest validation |
| `.github/actions/ssh-deploy/` | SSH transport, dedicated README and runner smoke test |
| `.github/fixtures/` | Frozen Bun/npm/pnpm and native-helper fixtures |
| `.github/slots/` | Z1 slot gate tests extracted from `quality.yml`, workflow contract tests |
| `docs/slots.md` | CI slot standard: numbering, declarations, Z1 rules, migration |

## Commands

Run from the repository root. Local helper checks need Node and Python 3; CI pins Node 26.12.1 for release and native-node self-tests. Install actionlint separately (CI verifies 1.7.12). There is no root package install or bundler.

```bash
actionlint -shellcheck= -pyflakes=
node --test .github/actions/docker-manifest/index.test.mjs
node --test .github/actions/release-source/resolve.test.mjs .github/actions/release-source/workflow-contract.test.mjs
node --test .github/slots/quality.workflow-contract.test.mjs
python3 -m unittest discover -s .github/actions/setup-js -p 'test_*.py'
python3 -m unittest discover -s .github/actions/configure-env -p 'test_*.py'
python3 -m unittest discover -s .github/slots -p 'test_*.py'
git diff --check
```

Package-manager/lifecycle and SSH smoke suites run in disposable GitHub runners; do not run their runner setup against the daily workstation.

## Verification

System0 quality slots (nocoo/workflow `system0-quality` skill) define what each slot means; base-ci implements them in `quality.yml` with wiring documented in [docs/slots.md](docs/slots.md). Status is `enforced`, `planned`, `manual`, or `N/A`; gaps describe current implementation, not a weaker required bar.

| Area | Required proof | Status | Current enforcement / gap |
|---|---|---|---|
| Helper static / coverage (L1 local bar in skill) | Statements, branches, functions and lines each ≥95%; check-only lint/types | planned | Node and Python behavioral tests in `self-test.yml`; no four-metric coverage threshold on helpers; no pre-commit index gate |
| Owned HTTP API | Real HTTP over every owned endpoint | N/A | No application HTTP API; fixtures exercise reusable workflows |
| Workflows (L3 skill stage) | Install, quality, scanners, SSH, release proof | enforced | `self-test-quality.yml`, `self-test.yml`, `self-test-ssh-deploy.yml`, `self-test-release.yml` |
| G1/G2 in CI | Secrets on checkout; lockfile OSV | enforced | Inlined in `quality.yml`; standalone `security.yml` for direct callers |
| Isolation | Disposable runners, no prod writes | planned | GitHub-hosted runners; local fixture guards incomplete |
| Docs | Inputs match behavior; skill is slot SoT | manual | `docs/slots.md` is implementation-only; skill is canonical for slot definitions |

No project commit/push hooks are configured. Target pre-commit is unified L1 (types, check-only lint, coverage) on the index snapshot (<30s); pre-push is applicable integration+G2 on stdin push refs (<3min). Those local gates remain planned. Hooks must be check-only; never use `--no-verify` on commits or branch pushes.

## Operations / Release

Maintainers publish immutable `v2026.N` releases only after provider self-tests and representative JS/native/Worker/Docker consumer CI and Release validation. Keep runtime upgrades separate from workflow-reference updates.
The historical moving `v2026` tag is not an upgrade policy. New integrations use `quality.yml`; the old `bun-quality.yml` interface remains only for existing consumers pinned to it.
Project operators own actual deployment approval, production health checks and package publication. A YAML pass proves neither deployment nor publication. Full procedures and input contracts are in [README.md](README.md).

## Retrospective

Accident narratives stay in [Retrospective.md](Retrospective.md). Keep only recurring project rules here; cross-project lessons belong to global rules/nmem, and deterministic checks belong in tests or hooks.
