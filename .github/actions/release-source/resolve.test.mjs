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
const OTHER_RUN = 3456789013;
const REPO = 'nocoo/backy';
const PATH = '.github/workflows/ci.yml';
const NAME = 'CI';

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
    expectedWorkflowPath: PATH,
    expectedWorkflowName: NAME,
    allowedSourceEvents: 'push',
    expectedBranch: 'main',
    requireFreshMain: false,
    fetchImpl: api({}),
    ...overrides,
  };
}

test('workflow_run proof accepts a GET-validated same-repo success', async () => {
  const resolved = await resolveReleaseSource(
    baseOptions({
      sourceRunId: String(RUN_ID),
      fetchImpl: api({
        [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
      }),
    }),
  );
  assert.deepEqual(resolved, {
    'target-sha': SHA,
    'source-run-id': String(RUN_ID),
    'event-type': 'run',
    'workflow-path': PATH,
    'head-branch': 'main',
  });
});

test('source-sha must match the proven run and cannot replace proof', async () => {
  const fetchImpl = api({
    [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
  });
  const resolved = await resolveReleaseSource(
    baseOptions({ sourceRunId: String(RUN_ID), sourceSha: SHA, fetchImpl }),
  );
  assert.equal(resolved['target-sha'], SHA);
  await assert.rejects(
    () => resolveReleaseSource(baseOptions({ sourceRunId: String(RUN_ID), sourceSha: SHA_B, fetchImpl })),
    /does not match proven SHA/,
  );
  await assert.rejects(
    () => resolveReleaseSource(baseOptions({ sourceSha: SHA, fetchImpl })),
    /refusing github.sha and latest-green fallback/,
  );
});

test('same-run proof requires needs SHA equality and a current run id', async () => {
  const resolved = await resolveReleaseSource(
    baseOptions({
      sameRunProof: true,
      sourceSha: SHA,
      githubSha: SHA,
      githubRunId: '99',
    }),
  );
  assert.equal(resolved['event-type'], 'same-run');
  assert.equal(resolved['source-run-id'], '99');
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({ sameRunProof: true, sourceSha: SHA, githubSha: SHA_B, githubRunId: '99' }),
      ),
    /does not match github.sha/,
  );
  await assert.rejects(
    () => resolveReleaseSource(baseOptions({ sameRunProof: true, githubSha: SHA, githubRunId: '99' })),
    /requires source-sha/,
  );
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({
          sameRunProof: true,
          sourceSha: SHA,
          githubSha: SHA,
          githubRunId: '99',
          sourceRunId: String(RUN_ID),
        }),
      ),
    /cannot be combined/,
  );
});

test('tag proof peels annotated tags and GET-validates the selected run id', async () => {
  let gotRun = false;
  const fetchImpl = api({
    [`/repos/${REPO}/git/ref/tags/v1.2.3`]: {
      ref: 'refs/tags/v1.2.3',
      object: { type: 'tag', sha: SHA_C },
    },
    [`/repos/${REPO}/git/tags/${SHA_C}`]: {
      object: { type: 'commit', sha: SHA },
    },
    [`/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&status=completed&per_page=100`]: {
      workflow_runs: [
        runPayload({ id: OTHER_RUN, head_sha: SHA_B, conclusion: 'success' }),
        runPayload(),
      ],
    },
    [`/repos/${REPO}/actions/runs/${RUN_ID}`]: () => {
      gotRun = true;
      return jsonResponse(runPayload());
    },
  });
  const resolved = await resolveReleaseSource(baseOptions({ tag: 'v1.2.3', fetchImpl }));
  assert.equal(resolved['target-sha'], SHA);
  assert.equal(resolved['source-run-id'], String(RUN_ID));
  assert.equal(resolved['event-type'], 'tag');
  assert.equal(gotRun, true);
});

test('tag proof does not fall back to a green run on another SHA', async () => {
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({
          tag: 'v1.2.3',
          fetchImpl: api({
            [`/repos/${REPO}/git/ref/tags/v1.2.3`]: {
              ref: 'refs/tags/v1.2.3',
              object: { type: 'commit', sha: SHA },
            },
            [`/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&status=completed&per_page=100`]: {
              workflow_runs: [runPayload({ head_sha: SHA_B })],
            },
          }),
        }),
      ),
    /No successful/,
  );
});

test('rejects fork, PR, wrong path/name, failed conclusion and short SHA', async () => {
  const cases = [
    [{ head_repository: { full_name: 'evil/backy' } }, /head repository/],
    [{ repository: { full_name: 'evil/backy' } }, /Run repository/],
    [{ event: 'pull_request' }, /untrusted source event/],
    [{ path: '.github/workflows/other.yml' }, /workflow path/],
    [{ name: 'Tests' }, /workflow name/],
    [{ head_branch: 'feature' }, /source branch/],
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
            sourceRunId: String(RUN_ID),
            fetchImpl: api({
              [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(override),
            }),
          }),
        ),
      pattern,
    );
  }
});

test('fresh main check fails closed for stale continuous deploys', async () => {
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({
          sourceRunId: String(RUN_ID),
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
  const resolved = await resolveReleaseSource(
    baseOptions({
      sourceRunId: String(RUN_ID),
      requireFreshMain: true,
      fetchImpl: api({
        [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
        [`/repos/${REPO}/git/ref/heads/main`]: {
          ref: 'refs/heads/main',
          object: { sha: SHA },
        },
      }),
    }),
  );
  assert.equal(resolved['target-sha'], SHA);
});

test('package-version-match compares the tag with package.json at the proven SHA', async () => {
  const pkg = Buffer.from(JSON.stringify({ version: '1.2.3' })).toString('base64');
  const fetchImpl = api({
    [`/repos/${REPO}/git/ref/tags/v1.2.3`]: {
      ref: 'refs/tags/v1.2.3',
      object: { type: 'commit', sha: SHA },
    },
    [`/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&status=completed&per_page=100`]: {
      workflow_runs: [runPayload()],
    },
    [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
    [`/repos/${REPO}/contents/package.json?ref=${SHA}`]: { encoding: 'base64', content: pkg },
  });
  const resolved = await resolveReleaseSource(
    baseOptions({ tag: 'refs/tags/v1.2.3', packageVersionMatch: true, fetchImpl }),
  );
  assert.equal(resolved['target-sha'], SHA);
  const mismatch = Buffer.from(JSON.stringify({ version: '9.9.9' })).toString('base64');
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({
          tag: 'v1.2.3',
          packageVersionMatch: true,
          fetchImpl: api({
            [`/repos/${REPO}/git/ref/tags/v1.2.3`]: {
              ref: 'refs/tags/v1.2.3',
              object: { type: 'commit', sha: SHA },
            },
            [`/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&status=completed&per_page=100`]: {
              workflow_runs: [runPayload()],
            },
            [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
            [`/repos/${REPO}/contents/package.json?ref=${SHA}`]: { encoding: 'base64', content: mismatch },
          }),
        }),
      ),
    /does not match package.json version/,
  );
});

test('run-id plus tag must agree on the peeled commit', async () => {
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({
          sourceRunId: String(RUN_ID),
          tag: 'v1.2.3',
          fetchImpl: api({
            [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
            [`/repos/${REPO}/git/ref/tags/v1.2.3`]: {
              ref: 'refs/tags/v1.2.3',
              object: { type: 'commit', sha: SHA_B },
            },
          }),
        }),
      ),
    /does not match run/,
  );
});

test('missing run, invalid run id and untrusted caller events fail closed', async () => {
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({
          sourceRunId: String(RUN_ID),
          fetchImpl: api({}),
        }),
      ),
    /GitHub API 404/,
  );
  await assert.rejects(
    () => resolveReleaseSource(baseOptions({ sourceRunId: 'latest' })),
    /positive integer/,
  );
  await assert.rejects(
    () => resolveReleaseSource(baseOptions({ sourceRunId: String(RUN_ID), callerEventName: 'pull_request' })),
    /Rejected caller event/,
  );
  assert.ok(FORBIDDEN_SOURCE_EVENTS.includes('pull_request_target'));
  assert.throws(() => parseAllowedEvents('push,pull_request'), /cannot include untrusted/);
});

test('cli writes proven outputs without interpolating untrusted refs', async () => {
  const outputFile = join(mkdtempSync(join(tmpdir(), 'release-source-')), 'out');
  const resolved = await runCli(
    {
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: REPO,
      GITHUB_OUTPUT: outputFile,
      RELEASE_EXPECTED_WORKFLOW_PATH: PATH,
      RELEASE_EXPECTED_WORKFLOW_NAME: NAME,
      RELEASE_ALLOWED_SOURCE_EVENTS: 'push',
      RELEASE_EXPECTED_BRANCH: 'main',
      RELEASE_SOURCE_RUN_ID: String(RUN_ID),
      RELEASE_REQUIRE_FRESH_MAIN: 'false',
    },
    api({
      [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
    }),
  );
  assert.equal(resolved['target-sha'], SHA);
  assert.match(readFileSync(outputFile, 'utf8'), new RegExp(`target-sha=${SHA}`));
});
