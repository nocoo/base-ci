# Changelog

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
