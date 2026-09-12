import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  FORBIDDEN_SOURCE_EVENTS,
  parseAllowedEvents,
  resolveReleaseSource,
  runCli,
} from './resolve.mjs';

const SHA = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const ZERO = '0'.repeat(40);
const RUN_ID = 3456789012;
const REPO = 'nocoo/hermes-on-herdr';
const PATH = '.github/workflows/ci.yml';
const NAME = 'CI';
const TESTS_PATH = '.github/workflows/tests.yml';
const TESTS_NAME = 'Tests';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function runPayload(overrides = {}) {
  return {
    id: RUN_ID,
    name: NAME,
    path: PATH,
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    head_sha: SHA,
    head_branch: 'main',
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
    ...overrides,
  };
}

function api(handlers) {
  return async (url) => {
    const parsed = new URL(url);
    const key = `${parsed.pathname}${parsed.search}`;
    if (typeof handlers[key] === 'function') {
      return handlers[key](parsed);
    }
    if (handlers[key]) {
      return jsonResponse(handlers[key]);
    }
    return jsonResponse({ message: 'Not Found' }, 404);
  };
}

function baseOptions(overrides = {}) {
  return {
    token: 'test-token',
    repository: REPO,
    workflowPath: PATH,
    workflowName: NAME,
    allowedSourceEvents: 'push',
    branch: 'main',
    requireFreshMain: false,
    sourceRef: SHA,
    ciRunId: String(RUN_ID),
    fetchImpl: api({}),
    ...overrides,
  };
}

test('main CI push is proven by GET of ci-run-id and matching source-ref SHA', async () => {
  const resolved = await resolveReleaseSource(
    baseOptions({
      fetchImpl: api({
        [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
      }),
    }),
  );
  assert.deepEqual(resolved, { sha: SHA, 'run-id': String(RUN_ID) });
});

test('tag CI push may use the tag name as head_branch instead of main', async () => {
  const resolved = await resolveReleaseSource(
    baseOptions({
      workflowPath: TESTS_PATH,
      workflowName: TESTS_NAME,
      sourceRef: 'v1.2.3',
      fetchImpl: api({
        [`/repos/${REPO}/git/ref/tags/v1.2.3`]: {
          ref: 'refs/tags/v1.2.3',
          object: { type: 'commit', sha: SHA },
        },
        [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload({
          name: TESTS_NAME,
          path: TESTS_PATH,
          event: 'push',
          head_branch: 'v1.2.3',
        }),
      }),
    }),
  );
  assert.equal(resolved.sha, SHA);
  assert.equal(resolved['run-id'], String(RUN_ID));
});

test('tag CI with source-ref SHA still accepts head_branch tag name', async () => {
  const resolved = await resolveReleaseSource(
    baseOptions({
      sourceRef: SHA,
      fetchImpl: api({
        [`/repos/${REPO}/git/ref/tags/v1.2.3`]: {
          ref: 'refs/tags/v1.2.3',
          object: { type: 'commit', sha: SHA },
        },
        [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload({
          event: 'push',
          head_branch: 'v1.2.3',
        }),
      }),
    }),
  );
  assert.equal(resolved.sha, SHA);
});

test('main CI for a later tag keeps head_branch=main and the same SHA', async () => {
  const resolved = await resolveReleaseSource(
    baseOptions({
      sourceRef: 'refs/tags/v1.2.3',
      fetchImpl: api({
        [`/repos/${REPO}/git/ref/tags/v1.2.3`]: {
          ref: 'refs/tags/v1.2.3',
          object: { type: 'tag', sha: SHA_C },
        },
        [`/repos/${REPO}/git/tags/${SHA_C}`]: {
          object: { type: 'commit', sha: SHA },
        },
        [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload({ head_branch: 'main' }),
      }),
    }),
  );
  assert.equal(resolved.sha, SHA);
});

test('source-ref cannot replace proof and must match the GET run SHA', async () => {
  const fetchImpl = api({
    [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
  });
  await assert.rejects(
    () => resolveReleaseSource(baseOptions({ sourceRef: SHA_B, fetchImpl })),
    /does not match run/,
  );
  await assert.rejects(
    () => resolveReleaseSource(baseOptions({ sourceRef: SHA, ciRunId: '', fetchImpl })),
    /ci-run-id must be a positive integer/,
  );
});

test('same-run-proof boolean is rejected', async () => {
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({
          sameRunProof: true,
          fetchImpl: api({
            [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
          }),
        }),
      ),
    /same-run-proof is not accepted/,
  );
});

test('rejects fork, PR, wrong path/name, failed conclusion and short SHA', async () => {
  const cases = [
    [{ head_repository: { full_name: 'evil/hermes' } }, /head repository/],
    [{ repository: { full_name: 'evil/hermes' } }, /Run repository/],
    [{ event: 'pull_request' }, /untrusted source event/],
    [{ path: '.github/workflows/other.yml' }, /workflow path/],
    [{ name: 'Other' }, /workflow name/],
    [{ conclusion: 'failure' }, /not success/],
    [{ status: 'in_progress', conclusion: null }, /not completed/],
    [{ head_sha: 'abc' }, /full 40-character/],
    [{ head_sha: ZERO }, /full 40-character/],
  ];
  for (const [override, pattern] of cases) {
    await assert.rejects(
      () =>
        resolveReleaseSource(
          baseOptions({
            fetchImpl: api({
              [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(override),
            }),
          }),
        ),
      pattern,
    );
  }
});

test('feature head_branch that is not the branch and not a tag for the SHA fails', async () => {
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({
          fetchImpl: api({
            [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload({ head_branch: 'feature' }),
          }),
        }),
      ),
    /GitHub API 404/,
  );
});

test('freshness applies to default-branch CI and is skipped for tag CI', async () => {
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({
          requireFreshMain: true,
          fetchImpl: api({
            [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
            [`/repos/${REPO}/git/ref/heads/main`]: {
              ref: 'refs/heads/main',
              object: { sha: SHA_B },
            },
          }),
        }),
      ),
    /Stale deploy/,
  );
  const tagged = await resolveReleaseSource(
    baseOptions({
      requireFreshMain: true,
      sourceRef: 'v1.2.3',
      fetchImpl: api({
        [`/repos/${REPO}/git/ref/tags/v1.2.3`]: {
          ref: 'refs/tags/v1.2.3',
          object: { type: 'commit', sha: SHA },
        },
        [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload({ head_branch: 'v1.2.3' }),
      }),
    }),
  );
  assert.equal(tagged.sha, SHA);
});

test('package-version-match compares a vX.Y.Z source-ref with package.json', async () => {
  const pkg = Buffer.from(JSON.stringify({ version: '1.2.3' })).toString('base64');
  const resolved = await resolveReleaseSource(
    baseOptions({
      sourceRef: 'v1.2.3',
      packageVersionMatch: true,
      fetchImpl: api({
        [`/repos/${REPO}/git/ref/tags/v1.2.3`]: {
          ref: 'refs/tags/v1.2.3',
          object: { type: 'commit', sha: SHA },
        },
        [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
        [`/repos/${REPO}/contents/package.json?ref=${SHA}`]: { encoding: 'base64', content: pkg },
      }),
    }),
  );
  assert.equal(resolved.sha, SHA);
});

test('missing run, invalid run id and untrusted allowed events fail closed', async () => {
  await assert.rejects(
    () => resolveReleaseSource(baseOptions({ fetchImpl: api({}) })),
    /GitHub API 404/,
  );
  await assert.rejects(
    () => resolveReleaseSource(baseOptions({ ciRunId: 'latest' })),
    /positive integer/,
  );
  assert.ok(FORBIDDEN_SOURCE_EVENTS.includes('pull_request_target'));
  assert.throws(() => parseAllowedEvents('push,pull_request'), /cannot include untrusted/);
});

test('cli writes sha and run-id without interpolating untrusted refs', async () => {
  const outputFile = join(mkdtempSync(join(tmpdir(), 'release-source-')), 'out');
  const resolved = await runCli(
    {
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: REPO,
      GITHUB_OUTPUT: outputFile,
      RELEASE_WORKFLOW_PATH: PATH,
      RELEASE_WORKFLOW_NAME: NAME,
      RELEASE_ALLOWED_SOURCE_EVENTS: 'push',
      RELEASE_BRANCH: 'main',
      RELEASE_SOURCE_REF: SHA,
      RELEASE_CI_RUN_ID: String(RUN_ID),
      RELEASE_REQUIRE_FRESH_MAIN: 'false',
    },
    api({
      [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
    }),
  );
  assert.equal(resolved.sha, SHA);
  assert.match(readFileSync(outputFile, 'utf8'), new RegExp(`sha=${SHA}`));
  assert.match(readFileSync(outputFile, 'utf8'), new RegExp(`run-id=${RUN_ID}`));
});
