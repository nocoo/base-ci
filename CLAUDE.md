# base-ci

Reusable GitHub Actions for Bun/TypeScript repos (6DQ jobs + SSH deploy action).
Profile: docs-config
Direction: [README.md](README.md). No `docs/` tree. Frameworks must not rewrite this file.

## Sources of Truth

This file is the **contract**. Workflows and self-test CI are **enforcement**. If they disagree, that is a failure — raise enforcement; never lower this file.

| Fact | Where |
|---|---|
| Agent handbook | this file |
| Human docs | README.md, `.github/actions/ssh-deploy/README.md` |
| Version | git tags `v2026`, `v2026.N` (latest `v2026.6`) |
| Enforcement | `.github/workflows/self-test.yml`, `self-test-ssh-deploy.yml` |
| Machine rules | global `AGENTS.md`, `rules/git-commit.md` |
| Env files | omit |

## Project Invariants

- Consumers should pin `nocoo/base-ci/.github/workflows/bun-quality.yml@v2026.N`. Moving tag `v2026` currently points at `v2026.1`, not latest `v2026.6` — do not treat `@v2026` as current.
- This repo must not store caller secrets. `secrets: inherit` stays on the caller.
- `ignore-scripts` / `trusted-native-deps` are supply-chain contract: keep them consistent with the caller’s `package.json#trustedDependencies`.
- Changing `bun-quality.yml` inputs or job names is a breaking change; bump a `v2026.N` tag and keep `v2026` moving only when intended.
- Do not weaken self-test assertions to land a workflow edit.

## Stack / Layout

| Component | Choice |
|---|---|
| Language | YAML + composite actions (bash) |
| Package manager | omit (fixture Bun locks only under `.github/fixtures/`) |
| Runtime | GitHub Actions |
| Lint | YAML parse in `self-test.yml` |
| Tests | `self-test.yml` + `self-test-ssh-deploy.yml` |
| Data | none |

```
.github/workflows/bun-quality.yml     reusable 6DQ workflow
.github/workflows/self-test.yml       syntax + fixture run
.github/actions/ssh-deploy/           composite SSH deploy
.github/fixtures/self-test/           dummy Bun app for the reusable workflow
```

## Commands

No root package scripts. This machine has no PyYAML. Validation is GitHub `self-test.yml` on push/PR to `main`.

## Verification

Status: `enforced` | `planned` | `manual` | `N/A`. `enforced` Evidence = hook/CI/config/script. `planned` has no Evidence.

docs-config: omit product L1/L2/L3/G2/build/release rows. This repo’s bar is self-test CI.

| Change | Proof | Status | Evidence |
|---|---|---|---|
| Workflow syntax | YAML load + a few input asserts | enforced | `self-test.yml` `validate` (not every public input/job id) |
| Reusable workflow behavior | caller `uses: bun-quality.yml` | planned | — (self-test mirrors install recipes, does not call the reusable workflow) |
| SSH deploy action | smoke workflow | enforced | `self-test-ssh-deploy.yml` on PR to `main` (push trigger is still `feat/ssh-deploy-action` only) |
| Types / lint / coverage | n/a product suite | N/A | — |
| Docs | README matches new inputs | manual | human review |
| Release | annotated tag `v2026.N`; move `v2026` only when intended | manual | operator `git tag` |

No local husky. `--no-verify` still forbidden if hooks appear later.
