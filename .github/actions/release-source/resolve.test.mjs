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
    eventName: 'workflow_run',
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
  });
});

test('hermes tag CI matches when expected-branch is the tag name', async () => {
  const resolved = await resolveReleaseSource(
    baseOptions({
      eventName: 'push',
      expectedWorkflowPath: TESTS_PATH,
      expectedWorkflowName: TESTS_NAME,
      expectedBranch: 'v1.2.3',
      tag: 'v1.2.3',
      sourceRunId: String(RUN_ID),
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
  assert.equal(resolved['target-sha'], SHA);
  assert.equal(resolved['source-run-id'], String(RUN_ID));
});

test('tag CI head_branch is not accepted when expected-branch stays main', async () => {
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({
          eventName: 'push',
          tag: 'v1.2.3',
          sourceRunId: String(RUN_ID),
          expectedBranch: 'main',
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
      ),
    /expected "main"/,
  );
});

test('tag-only proof GET-validates the selected run and does not take another SHA', async () => {
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
      workflow_runs: [runPayload({ id: OTHER_RUN, head_sha: SHA_B }), runPayload()],
    },
    [`/repos/${REPO}/actions/runs/${RUN_ID}`]: () => {
      gotRun = true;
      return jsonResponse(runPayload());
    },
  });
  const resolved = await resolveReleaseSource(
    baseOptions({ eventName: 'workflow_dispatch', tag: 'v1.2.3', fetchImpl }),
  );
  assert.equal(resolved['target-sha'], SHA);
  assert.equal(gotRun, true);
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
    /Provide source-run-id or tag/,
  );
});

test('GITHUB_EVENT_NAME is required and pull_request is rejected unconditionally', async () => {
  const fetchImpl = api({
    [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
  });
  await assert.rejects(
    () => resolveReleaseSource(baseOptions({ sourceRunId: String(RUN_ID), eventName: '', fetchImpl })),
    /GITHUB_EVENT_NAME is required/,
  );
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({ sourceRunId: String(RUN_ID), eventName: 'pull_request', fetchImpl }),
      ),
    /Rejected deploy event "pull_request"/,
  );
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({ sourceRunId: String(RUN_ID), eventName: 'pull_request_target', fetchImpl }),
      ),
    /Rejected deploy event/,
  );
  const nested = await resolveReleaseSource(
    baseOptions({ sourceRunId: String(RUN_ID), eventName: 'workflow_call', fetchImpl }),
  );
  assert.equal(nested['target-sha'], SHA);
});

test('schedule and release callers may present a proven main push run', async () => {
  const fetchImpl = api({
    [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload({ event: 'push', head_branch: 'main' }),
  });
  for (const eventName of ['schedule', 'release']) {
    const resolved = await resolveReleaseSource(
      baseOptions({ sourceRunId: String(RUN_ID), eventName, fetchImpl }),
    );
    assert.equal(resolved['target-sha'], SHA);
    assert.equal(resolved['source-run-id'], String(RUN_ID));
  }
});

test('default allowed-source-events=push still rejects a scheduled CI run', async () => {
  await assert.rejects(
    () =>
      resolveReleaseSource(
        baseOptions({
          sourceRunId: String(RUN_ID),
          eventName: 'schedule',
          fetchImpl: api({
            [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload({ event: 'schedule' }),
          }),
        }),
      ),
    /Rejected source event "schedule"/,
  );
  assert.equal(FORBIDDEN_SOURCE_EVENTS.includes('schedule'), false);
});

test('rejects fork, PR CI, wrong path/name, failed conclusion and short SHA', async () => {
  const cases = [
    [{ head_repository: { full_name: 'evil/hermes' } }, /head repository/],
    [{ repository: { full_name: 'evil/hermes' } }, /Run repository/],
    [{ event: 'pull_request' }, /untrusted source event/],
    [{ path: '.github/workflows/other.yml' }, /workflow path/],
    [{ name: 'Other' }, /workflow name/],
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

test('fresh main check fails closed for stale continuous deploys and is skipped for tags', async () => {
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
  const tagged = await resolveReleaseSource(
    baseOptions({
      sourceRunId: String(RUN_ID),
      tag: 'v1.2.3',
      requireFreshMain: true,
      fetchImpl: api({
        [`/repos/${REPO}/git/ref/tags/v1.2.3`]: {
          ref: 'refs/tags/v1.2.3',
          object: { type: 'commit', sha: SHA },
        },
        [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
      }),
    }),
  );
  assert.equal(tagged['target-sha'], SHA);
});

test('missing run, invalid run id and untrusted allowed events fail closed', async () => {
  await assert.rejects(
    () => resolveReleaseSource(baseOptions({ sourceRunId: String(RUN_ID), fetchImpl: api({}) })),
    /GitHub API 404/,
  );
  await assert.rejects(
    () => resolveReleaseSource(baseOptions({ sourceRunId: 'latest' })),
    /positive integer/,
  );
  assert.ok(FORBIDDEN_SOURCE_EVENTS.includes('pull_request_target'));
  assert.throws(() => parseAllowedEvents('push,pull_request'), /cannot include untrusted/);
});

test('cli ignores spoofed caller-event env and only reads GITHUB_EVENT_NAME', async () => {
  const fetchImpl = api({
    [`/repos/${REPO}/actions/runs/${RUN_ID}`]: runPayload(),
  });
  const env = {
    GITHUB_TOKEN: 'test-token',
    GITHUB_REPOSITORY: REPO,
    GITHUB_OUTPUT: join(mkdtempSync(join(tmpdir(), 'release-source-')), 'out'),
    RELEASE_EXPECTED_WORKFLOW_PATH: PATH,
    RELEASE_EXPECTED_WORKFLOW_NAME: NAME,
    RELEASE_ALLOWED_SOURCE_EVENTS: 'push',
    RELEASE_EXPECTED_BRANCH: 'main',
    RELEASE_SOURCE_RUN_ID: String(RUN_ID),
    RELEASE_REQUIRE_FRESH_MAIN: 'false',
    RELEASE_CALLER_EVENT_NAME: 'schedule',
  };
  await assert.rejects(
    () => runCli({ ...env, GITHUB_EVENT_NAME: 'pull_request' }, fetchImpl),
    /Rejected deploy event "pull_request"/,
  );
  const resolved = await runCli({ ...env, GITHUB_EVENT_NAME: 'schedule' }, fetchImpl);
  assert.equal(resolved['target-sha'], SHA);
});

test('cli reads GITHUB_EVENT_NAME and writes target-sha and source-run-id', async () => {
  const outputFile = join(mkdtempSync(join(tmpdir(), 'release-source-')), 'out');
  const resolved = await runCli(
    {
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: REPO,
      GITHUB_EVENT_NAME: 'workflow_run',
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
  const text = readFileSync(outputFile, 'utf8');
  assert.match(text, new RegExp(`target-sha=${SHA}`));
  assert.match(text, new RegExp(`source-run-id=${RUN_ID}`));
});
