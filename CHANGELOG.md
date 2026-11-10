# Changelog

## v2026.11 - 2026-11-10

- Introduce the CI slot standard v1 in `docs/slots.md`: numbered slots (`S1`, `S2`, `S3`, `G1`, `G2`, `B1`, `L1`, `L1.5`, `L2`, `L3`, `P1`, `Z1`), one declaration format and one numbering contract for every consuming repository.
- **Breaking**: rename the reusable workflow jobs after their slot: `Quality Gate Aggregate` -> `Z1: Gate`, `L1: Quality & Tests` -> `L1: Unit Tests & Coverage`, `Build` -> `B1: Build`, `Worker Tests` -> `L1.5: Worker Runtime Tests`, `Package Check` -> `P1: Package Check`. Branch protection required checks must follow the new names.
- **Breaking**: split `G2: Security` into `G1: Secret Scan` and `G2: Dependency Vulnerabilities`. The legacy `security: true` input still enables both, and a custom `security-command` still runs exactly once.
- Add the `slot-status` input. An empty value keeps the legacy boolean-derived behaviour and the `disabled-check-reasons` contract; a non-empty JSON declaration switches to the strict mode, where every v1 slot must be declared as `impl`, `na` or `todo` and `Z1: Gate` verifies the declarations against the jobs and steps that actually ran. `{}` is a strict empty declaration and fails.
- Add the `S3: Workflow Lint` slot with the `workflow-lint`, `workflow-lint-files`, `workflow-lint-required-workflow` and `workflow-lint-yamllint` inputs. `workflow-lint.yml` now reports `tested-sha` and carries the `S3: Workflow Lint` job name.
- Keep every existing input (`typecheck`, `lint`, `unit`, `security`, `build`, `worker`, `l2`, `l3`, `package-check`, `disabled-check-reasons`) and the `tested-sha` / `artifact-id` output semantics unchanged, so pinned consumers keep working when they only bump the reference SHA.
- Keep the Z1 validation inline in `quality.yml`; no new composite action and no internal SHA re-pinning.
- Add `test-job.yml` slot labels so the nested job names of `L1.5`, `L2`, `L3` and `P1` carry their slot number.
- Leave `bun-quality.yml` untouched: the legacy interface keeps its job names.
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
