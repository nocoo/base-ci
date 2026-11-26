# Changelog

## v2026.20 - 2026-11-26

- Upgrade `.github/actions/setup-playwright` to skip redundant `apt-get install-deps` on Linux runners when shared libraries are already satisfied:
  - Change `inputs.install-deps` default from `"true"` to `"auto"` (`auto` / `true` / `force` / `false`; invalid values fail loudly with `::error::`).
  - Under `auto` (and `true`, treated identically so existing callers immediately benefit), download browsers without `--with-deps` on cache miss, inspect executable browser binaries under `$CACHE_PATH` (`chrome`, `chrome-headless-shell`, `headless_shell`, `firefox`, `MiniBrowser`) with `ldd`, and skip `playwright install-deps` when `ldd` reports zero `not found` libraries. Fall back safely to `install-deps` when any shared library is missing or when no browser binaries are found.
  - Keep `force` for unconditional single-pass `install --with-deps` / `install-deps` and `false` to never install Linux OS dependencies.
- Expand `.github/slots/thin-actions.test.mjs` to cover `auto`, `true`, `force`, `false`, clean/missing `ldd`, missing-binary fallback, macOS, and invalid `install-deps` values deterministically via fake `LDD_BIN` + `$CACHE_PATH`.
- Extend `L4: E2E (Thin Action)` in `.github/workflows/self-test-quality.yml` to verify both `install-deps: "force"` and real Ubuntu `ldd` clean skip under `install-deps: "auto"`.

## v2026.19 - 2026-11-26

- Read `CLOUDFLARE_ACCOUNT_ID` from GitHub environment variables (`vars.CLOUDFLARE_ACCOUNT_ID`) instead of secrets in `.github/workflows/deploy-worker.yml`, and expose `DEPLOY_PHASE`, `DEPLOY_URL`, and `DEPLOY_ORIGIN_MARKER` from environment variables (`vars.DEPLOY_*`) in `.github/workflows/deploy-docker.yml`'s `Verify deployed service` step (`98fc0234`).

## v2026.18 - 2026-11-26

- Add thin composite actions for `L4` and `Z1` in custom/native slot workflows:
  - `.github/actions/setup-playwright` (`L4: E2E`): resolves Playwright version from `node_modules` or `package.json`, standardizes `PLAYWRIGHT_BROWSERS_PATH` (`~/.cache/ms-playwright` when unset), caches browsers via `actions/cache@v6.1.0`, and enforces a single-pass browser/system dependency install (`install --with-deps` on cold Linux, `install-deps` on warm Linux cache hit, `install` on macOS/no-deps, skip on warm non-Linux cache hit).
  - `.github/actions/z1-gate` (`Z1: Gate`): checkout-free composite gate verifying `needs-json` against `expected-sha`, `required-jobs`, `skipped-jobs`, `no-sha-jobs`, and `allow-extra-needs`, writing a Markdown summary table to `$GITHUB_STEP_SUMMARY` and emitting `tested-sha`.
- Extend `.github/slots/thin-actions.test.mjs` and `.github/workflows/self-test-quality.yml` to cover `L4: E2E (Thin Action)` and `Z1: Gate (Thin Action)` alongside `S3`, `G1`, and `G2`.

## v2026.17 - 2026-11-25

- Fix `Self Test — ssh-deploy` failing on runners with OpenSSH ≥ 9.8 (`ubuntu-26.04`). The runner's sshd now runs with `PerSourcePenalties no` and `MaxStartups 100:30:100` (written to `/etc/ssh/sshd_config.d/99-self-test.conf`, validated with `sshd -t`, confirmed with `sshd -T`; daemons without the option fall back to exempting `127.0.0.1,::1`, then to `MaxStartups` only), plus a 20-scan probe step that fails the job when sshd stops serving. Without this, `ssh-keyscan` (six unauthenticated connections per host) accumulated `noauth` penalties and sshd refused the runner's own source address — in run 44741457393 case 5 executed and failed at `Execute remote script` with `Connection closed by 127.0.0.1 port 22` (exit 255), which skipped case 5's assertions and case 6.
- `self-test-ssh-deploy.yml` captures the host key once in the key-pair step and passes it to cases 2–6 through `known-hosts:`; case 1 keeps exercising the action's live `ssh-keyscan` branch. All cases still run and are asserted.
- `self-test-ssh-deploy.yml` adds a negative case 7: a deliberately wrong host key must make the deployment fail (`continue-on-error` step) and the remote script must never run.
- `ssh-deploy` action: the private key and the host key material now live in invocation-specific temp files (`mktemp` under `$RUNNER_TEMP`) instead of fixed `~/.ssh` paths — nothing is written to `~/.ssh`, the shared `~/.ssh/known_hosts` is neither read nor written, only the provided `known-hosts` material or the live keyscan is trusted, and both files are removed in the cleanup step. Their paths are exported to `$GITHUB_ENV` right after creation, before any keyscan or validation, so the always-run cleanup can always find them, and an `ERR` trap removes them immediately if the setup step fails. The connection uses `StrictHostKeyChecking=yes` plus `ConnectTimeout=30`, and the action fails fast with `::error::` when no host key can be obtained. The action README now spells out that only a pinned `known-hosts:` keeps host identity across deployments and protects against MITM / host key changes, while the default live scan is per-deployment TOFU.
- Add three thin Ubuntu composite actions for consumers composing `S3`, `G1`, and `G2` slots directly without `setup-js` or `yamllint`:
  - `.github/actions/lint-workflows` (`S3: Workflow`): downloads SHA256-verified `actionlint` `v1.7.12` into `$RUNNER_TEMP` (with `-shellcheck= -pyflakes=`) and runs a PyYAML check verifying every external `uses:` reference pins a full 40-hex commit SHA (`@[a-f0-9]{40}`) plus optional `required-reusable-workflow`.
  - `.github/actions/scan-secrets` (`G1: Secrets`): downloads only SHA256-verified `gitleaks` `v8.30.1` and runs `gitleaks dir . --no-banner --redact --log-level error` in `working-directory` with explicit or auto-detected `.gitleaks.toml` and `.gitleaksignore`.
  - `.github/actions/scan-dependencies` (`G2: Dependencies`): downloads only SHA256-verified `osv-scanner` `v2.5.1`, validates declared `lockfiles`, and runs a single batched `osv-scanner scan` with explicit or auto-detected `osv-scanner.toml`.
- Fix `.github/slots/internal-pin.test.mjs` minimum-pin comparison: replace broken hex `BigInt` ordering with real Git ancestry verification (`git merge-base --is-ancestor`, falling back to GitHub `/repos/nocoo/base-ci/compare/...` when shallow).
- Add `.github/slots/thin-actions.test.mjs` (wired into `self-test.yml`) and live thin-action smoke jobs in `self-test-quality.yml` (`S3: Workflow (Thin Action)`, `G1: Secrets (Thin Action)`, `G2: Dependencies (Thin Action)`), keeping all `self-test-quality.yml` jobs aligned with canonical slot names.

## v2026.16 - 2026-11-20

- Fix `release-source` `findSuccessfulRunForSha` failing on tag-triggered releases when GitHub's `/actions/workflows/{workflow}/runs` endpoint returns `total_count: 0` for combined `head_sha` + `status=completed` queries. Drop `&status=completed` from the list query and rely on `assertTrustedRun` plus the follow-up `GET /actions/runs/{id}` proof check.

## v2026.15 - 2026-11-12

- **Do not use v2026.14** — its tag commit left internal composite pins pointing at unreachable SHAs (for example `e215ac8…`), which breaks `deploy-worker.yml` / `deploy-docker.yml` and provider self-tests. Repin to this release’s full tag SHA.
- Set `.github/internal-provider-pin.txt` to a **reachable** commit on `main` that includes `release-source` `required-quality-check`; add `git cat-file` reachability checks in `internal-pin.test.mjs` and `.github/scripts/sync-provider-pin.mjs` for release maintenance.

## v2026.14 - 2026-11-11 — broken

**Broken release.** Internal provider pins were repointed to commit SHAs that were never pushed to `nocoo/base-ci` (amended-away objects such as `e215ac8011b63561e0b6307dbff2d22d79ae5f47`). Downstream `deploy-*` callers get GitHub 422 “No commit found”. Use **v2026.15** instead.

- Repin every internal `nocoo/base-ci` composite action reference to the provider SHA recorded in `.github/internal-provider-pin.txt`; add `internal-pin.test.mjs` so CI fails on stale or mismatched pins. `deploy-worker.yml` and `deploy-docker.yml` forward `required-quality-check` / `require-quality-check` to `release-source` (default `quality / Z1: Gate`).
- Restore canonical `quality.yml` inputs `l2-runtime`, `l3-integration`, `l4` and related `l4-*` command/artifact/browser fields removed during the workflow_call input-limit trim in v2026.13; keep `worker` / `l2` / `l3` aliases with Z1 conflict checks. Drop redundant inputs (`coverage-artifact-name`, single-browser `l3-browser`, `l3-browser-directory`, per-artifact retention-day knobs) with fixed coverage/evidence names and 7-day retention.
- Mark **v2026.12** as released (no longer “proposed”).

## v2026.13 - 2026-11-11

- **Breaking — System0 quality slots**: align `quality.yml` with [System0 quality skill v1.3.0](https://github.com/nocoo/workflow/blob/main/agents/skills/system0-quality/SKILL.md). Remove `L1.5`; remap Worker runtime → **L2 Runtime**, API/integration → **L3 Integration**, user journeys → **L4 E2E** (generic command; optional Playwright). Canonical check names update (for example `S1: Types`, `L3: Integration`, `L4: E2E`). Strict `slot-status` requires 12 keys including `L4`; key `L1.5` fails with migration text.
- Keep deprecated boolean aliases: `worker` → L2, `l2` → L3, `l3` → L4; add preferred `l2-runtime`, `l3-integration`, `l4` and `l4-*` inputs. Legacy empty `slot-status` unchanged.
- Z1 writes a GitHub Step summary table (per-slot status, reason, result, duration) and workflow duration vs 5m target / 10m reference.
- **Breaking — release proof**: `release-source` requires successful `quality / Z1: Gate` (or `required-quality-check`) on the exact proven SHA by default.
- `docs/slots.md` is implementation-only; slot definitions live in the skill. Migration table: v1 `L1.5`/`L2`/`L3` → System0 `L2`/`L3`/`L4` (see docs).

## v2026.12 - 2026-11-10

- Flatten the `quality.yml` check names: every slot is now a top-level job, so each slot renders exactly one check named `<ID>: <Canonical Name>` (`S1: Typecheck`, `S2: Lint`, `S3: Workflow Lint`, `G1: Secret Scan`, `G2: Dependency Vulnerabilities`, `B1: Build`, `L1: Unit Tests & Coverage`, `L1.5: Worker Runtime Tests`, `L2: API E2E`, `L3: Browser E2E`, `P1: Package Check`, `Z1: Gate`). The duplicated segments (`G1: Secret Scan / G1: Secret Scan`) and the runtime suffix (`L3: Browser E2E (bun on ubuntu-latest)`) are gone.
- **Breaking**: the required check names change again. Recommend keeping only `quality / Z1: Gate` as the required check: the prefix is the caller job display name (its `name:` when set, otherwise its key), so the caller job key must be `quality` with no `name:` or a `name:` of exactly `quality`; the workflow `name:` is not part of the check name. Read the real displayed name (`<caller job> / <slot>`) from a CI run instead of guessing it.
- `quality.yml` no longer calls `security.yml`, `workflow-lint.yml` or `test-job.yml`; their slot logic is inlined so a slot cannot fail through a nested reusable workflow. The three standalone workflows keep their behaviour and their job names for direct callers.
- **Breaking**: `S1: Typecheck` and `S2: Lint` are independent jobs with their own check, duration and tested SHA. `L1: Unit Tests & Coverage` stays a canonical job that always runs (it validates `disabled-check-reasons`); its unit step is skipped when `unit` is false, and `Z1: Gate` fails when the L1 job itself failed.
- Keep every existing input (`typecheck`, `lint`, `unit`, `security`, `build`, `worker`, `l2`, `l3`, `package-check`, `disabled-check-reasons`, `slot-status`, `l3-browser`, ...) and the `tested-sha` / `artifact-id` output semantics unchanged, so pinned consumers keep working when they only bump the reference SHA. The legacy boolean-derived path and the `disabled-check-reasons` contract are unchanged.
- Add the L3 inputs `l3-browsers` (space-separated browser list, installed as separate arguments through `playwright install --with-deps`), `l3-prepare-command` (falls back to `prepare-command`), `l3-artifact-name`, `l3-artifact-path` (multiline) and `l3-artifact-retention-days` (default 7). The old `l3-browser` input keeps working and stays the fallback.
- Add the L2 evidence inputs `l2-artifact-name`, `l2-artifact-path` and `l2-artifact-retention-days` (default 7). Both the L2 and the L3 evidence uploads run with `if: always()`, so a failed E2E run keeps its report.
- Document the canonical check names, the before/after mapping, the L3 multi-browser example, the L2 evidence notes and the slot boundaries in `docs/slots.md`: L1.5 is `na` for a static-asset Worker without a Workers-runtime suite, Playwright against `wrangler dev` belongs to L3, and a release `verify-command` is not L2.
- Cover the new contract in the self-tests: the strict path runs S1 and S2 as jobs, the workflow contract tests prove that `quality.yml` calls no reusable workflow and that every canonical job exists once, and the L3 self-test installs a browser list, runs an L3 prepare command and verifies the uploaded evidence artifact.

## v2026.11 - 2026-11-10

- Introduce the CI slot standard v1 in `docs/slots.md`: numbered slots (`S1`, `S2`, `S3`, `G1`, `G2`, `B1`, `L1`, `L1.5`, `L2`, `L3`, `P1`, `Z1`), one declaration format and one numbering contract for every consuming repository.
- **Breaking**: rename the reusable workflow jobs after their slot: `Quality Gate Aggregate` -> `Z1: Gate`, `L1: Quality & Tests` -> `L1: Unit Tests & Coverage`, `Build` -> `B1: Build`, `Worker Tests` -> `L1.5: Worker Runtime Tests`, `Package Check` -> `P1: Package Check`. Branch protection required checks must follow the new names.
- **Breaking**: split `G2: Security` into `G1: Secret Scan` and `G2: Dependency Vulnerabilities`. The legacy `security: true` input still enables both, and a custom `security-command` still runs exactly once.
- Add the `slot-status` input. An empty value keeps the legacy boolean-derived behaviour and the `disabled-check-reasons` contract; a non-empty JSON declaration switches to the strict mode, where every v1 slot must be declared as `impl`, `na` or `todo` and `Z1: Gate` verifies the declarations against the jobs and steps that actually ran. `na` and `todo` need a non-empty string reason; `{}` is a strict empty declaration and fails.
- Add the `S3: Workflow Lint` slot with the `workflow-lint`, `workflow-lint-files`, `workflow-lint-required-workflow` and `workflow-lint-yamllint` inputs. `workflow-lint.yml` now reports `tested-sha` and carries the `S3: Workflow Lint` job name.
- Keep every existing input (`typecheck`, `lint`, `unit`, `security`, `build`, `worker`, `l2`, `l3`, `package-check`, `disabled-check-reasons`) and the `tested-sha` / `artifact-id` output semantics unchanged, so pinned consumers keep working when they only bump the reference SHA.
- Keep the Z1 validation inline in `quality.yml`; no new composite action and no internal SHA re-pinning.
- Add `test-job.yml` slot labels so the nested job names of `L1.5`, `L2`, `L3` and `P1` carry their slot number.
- Leave `bun-quality.yml` untouched: the legacy interface keeps its job names.
- Migration detail: required check display names include the caller job prefix (the caller job's `name:` when set, otherwise its key). The nested `test-job.yml` jobs now carry their slot label, a standalone `security.yml` call is named `G1 + G2: Security Scan` and a standalone `workflow-lint.yml` call is named `S3: Workflow Lint`. The caller workflow name is a UI grouping and is not part of the check name. Read the real name from a CI run after upgrading instead of guessing it.
- Release source proof (`deploy-worker.yml`, `deploy-docker.yml`) validates repository, workflow, branch, event and exact SHA, not job names, so deployments need no change.
- Cover the slot gate locally in `.github/slots/` and run both a legacy and a strict declaration path in the self-tests.

## v2026.10 - 2026-11-10

- Adopt approved material identity assets (`assets/brand/`, bilingual README headers and brand usage scope).
- Bump the shared Node.js default from 26.8.1 to 26.12.1 (October 2026 security releases) in `setup-js`, `quality.yml`, `test-job.yml` and docs.
- Repin internal `nocoo/base-ci` composite action references to the provider SHA that carries the Node bump.
- Add optional Tailscale workload identity federation before SSH on `deploy-docker.yml` (`tailscale`, `tailscale-tags`, `tailscale-ping`, `TS_OAUTH_CLIENT_ID`, `TS_AUDIENCE`); default path unchanged when `tailscale` is false.
- Document Tailscale federation setup and caller secrets in `docs/workflows.md`.
- Preserve source proof, manifest validation, OpenSSH deploy keys and non-cancelling production locks.

## v2026.9 - 2026-10-14

- Add `resolve-locked-wrangler` and default `wrangler-version` to `lockfile` on `deploy-worker.yml`.
- Read the exact Wrangler version from `bun.lock`, `package-lock.json`, `pnpm-lock.yaml` or `yarn.lock` under `working-directory`; fail when lockfiles disagree.
- Preserve explicit semver `wrangler-version` pins and the unchanged `deploy-cli: cf` path.
- Pin the new composite action with a full internal SHA and extend release-source workflow contract tests.
- Document lockfile-derived Wrangler resolution in `docs/workflows.md` and `AGENTS.md`.

## v2026.8 - 2026-10-03

- Add `deploy-cli: cf` and exact project-local `cf-version` validation, including prerelease banners, without requiring Wrangler.
- Deploy cf production build output with `deploy --prebuilt --mode production` by default; apply remote D1 migrations by database UUID without Wrangler flags.
- Preserve default Wrangler deployment, named remote migrations and existing Wrangler path inputs.
- Let standalone `deploy-script` callers omit CLI dependencies and version inputs; shared migrations still validate their selected CLI.
- Validate the selected CLI before building and preserve literal glob arguments for custom migration layouts.
- Add executable workflow regression tests for Wrangler, cf, script overrides, CLI rejection and production-write ordering.
- Preserve source proof, freshness checks, named credentials, deployment locks and production verification.
- Document both CLI interfaces and retain the bilingual overview and project handbook updates since v2026.7.
