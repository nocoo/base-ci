<h1 align="center">base-ci</h1>
<p align="center">Reusable GitHub Actions checks and releases with verified source revisions.</p>
<p align="center"><a href="../README.md">简体中文</a></p>

## What it does

Shared JavaScript checks, native tests, security scans and release-source verification for nocoo projects. Consumers retain triggers, project commands and deployment environments; shared workflows manage tools, checks, artifacts and source proof.

## Features

| Workflow | Purpose |
| --- | --- |
| `quality.yml` | Bun/npm/pnpm type, lint, unit and security checks; optional builds/tests |
| `test-job.yml` | One command, caller matrix, native runtimes and browsers |
| `security.yml` | Multiple lockfiles and directory/full-history secret scanning |
| `workflow-lint.yml` | actionlint, YAML and immutable-reference checks |
| `deploy-worker.yml` | Prove CI source, then build, migrate and deploy a Worker |
| `deploy-docker.yml` | Same-commit image digests, Compose delivery and health checks |

## Usage

Create `.github/workflows/ci.yml` in the consuming repository. Replace `BASE_CI_SHA` with a reviewed release’s full 40-character commit SHA; the placeholder cannot be used directly:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  quality:
    uses: nocoo/base-ci/.github/workflows/quality.yml@BASE_CI_SHA
    with:
      runtime-version: '1.4.2'
      install-policy: blocked
      coverage-path: coverage
```

Type, lint, unit and security checks default to enabled; optional checks require explicit activation. Commands default to the selected package manager’s project scripts, which must exist in the consumer. `coverage-path` must name a real report. See [integration](workflows.md) for inputs, native jobs and Worker/Docker examples.

## Development

There is no root package install or bundler. Helpers live in `.github/actions/`, workflows in `.github/workflows/`, and fixtures in `.github/fixtures/`. Local checks require Node.js, Python 3 and actionlint.

Pin full SHAs and preserve immutable release tags. Production credentials belong only to deployment environments; tests receive named test credentials. Source proof requires matching repository, workflow, branch, success and revision; missing evidence never falls back to the latest green run.

## Tests

```sh
actionlint -shellcheck= -pyflakes=
node --test .github/actions/docker-manifest/index.test.mjs
node --test .github/actions/release-source/resolve.test.mjs .github/actions/release-source/workflow-contract.test.mjs
python3 -m unittest discover -s .github/actions/setup-js -p 'test_*.py'
python3 -m unittest discover -s .github/actions/configure-env -p 'test_*.py'
```

GitHub self-tests exercise real installation, lifecycle policies, scanners, SSH and release-source validation. Package-manager setup and SSH runner configuration tests run on disposable CI runners, not the daily workstation. Actual production end-to-end evidence comes from consumer releases.

## Stack

| Technology | Role |
| --- | --- |
| GitHub Actions / YAML | Reusable workflows and composite actions |
| Python, JavaScript, Shell | Installation, environment, source and deployment helpers |
| Node test runner, unittest | Helper behavior checks |
| actionlint, Gitleaks, OSV Scanner | Workflow, secret and dependency checks |

## Documentation

- [Complete workflow integration guide](workflows.md).
- [Workflow input definitions](../.github/workflows/).
- [SSH deploy action](../.github/actions/ssh-deploy/README.md).
- [Maintenance guide](../CLAUDE.md).

## License

The repository has no project-level LICENSE. External tools retain their own terms.
