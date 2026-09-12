import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHA_RE = /^[a-f0-9]{40}$/i;
const ZERO_SHA = '0'.repeat(40);
const RUN_ID_RE = /^[1-9][0-9]{0,18}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_PATH_RE = /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/;
const WORKFLOW_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const TAG_RE = /^(refs\/tags\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const VERSION_TAG_RE = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const PACKAGE_PATH_RE = /^(package\.json|[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/package\.json)$/;

export const FORBIDDEN_SOURCE_EVENTS = Object.freeze([
  'pull_request',
  'pull_request_target',
  'pull_request_review',
  'pull_request_review_comment',
  'pull_request_comment',
  'issue_comment',
  'issues',
  'fork',
  'schedule',
]);

export function isFullSha(value) {
  return typeof value === 'string' && SHA_RE.test(value.trim()) && value.trim().toLowerCase() !== ZERO_SHA;
}

export function parseBoolean(value, name) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false' || value === '' || value == null) return false;
  throw new Error(`${name} must be true or false`);
}

export function parseRunId(value, name = 'source-run-id') {
  const raw = String(value ?? '').trim();
  if (!RUN_ID_RE.test(raw)) {
    throw new Error(`${name} must be a positive integer run ID`);
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) {
    throw new Error(`${name} is not a safe integer`);
  }
  return id;
}

export function normalizeSha(value, name) {
  if (!isFullSha(value)) {
    throw new Error(`${name} must be a full 40-character commit SHA`);
  }
  return value.trim().toLowerCase();
}

export function normalizeRepository(value) {
  const repo = String(value ?? '').trim();
  if (!REPO_RE.test(repo)) {
    throw new Error(`Invalid repository "${repo}"`);
  }
  return repo;
}

export function normalizeWorkflowPath(value) {
  const path = String(value ?? '').trim();
  if (!WORKFLOW_PATH_RE.test(path)) {
    throw new Error(`expected-workflow-path must be a .github/workflows/*.yml path, got "${path}"`);
  }
  return path;
}

export function normalizeWorkflowName(value) {
  const name = String(value ?? '').trim();
  if (!WORKFLOW_NAME_RE.test(name)) {
    throw new Error(`expected-workflow-name is missing or invalid: "${name}"`);
  }
  return name;
}

export function normalizeBranch(value) {
  const branch = String(value ?? '').trim();
  if (!BRANCH_RE.test(branch) || branch.includes('..')) {
    throw new Error(`expected-branch is invalid: "${branch}"`);
  }
  return branch;
}

export function normalizeTag(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!TAG_RE.test(raw) || raw.includes('..')) {
    throw new Error(`tag is invalid: "${raw}"`);
  }
  return raw.startsWith('refs/tags/') ? raw.slice('refs/tags/'.length) : raw;
}

export function parseAllowedEvents(value) {
  const items = String(value ?? '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = items.length > 0 ? items : ['push'];
  for (const event of allowed) {
    if (FORBIDDEN_SOURCE_EVENTS.includes(event)) {
      throw new Error(`allowed-source-events cannot include untrusted event "${event}"`);
    }
    if (!/^[a-z][a-z0-9_]*$/.test(event)) {
      throw new Error(`allowed-source-events contains an invalid event "${event}"`);
    }
  }
  return allowed;
}

function repoUrl(apiBase, repository, suffix) {
  return `${apiBase.replace(/\/$/, '')}/repos/${repository}${suffix}`;
}

async function githubJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'nocoo-base-ci-release-source',
    },
  });
  if (!response.ok) {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    throw new Error(`GitHub API ${response.status} for ${path}`);
  }
  return response.json();
}

function repoFullName(entity) {
  if (!entity || typeof entity !== 'object') return '';
  if (typeof entity.full_name === 'string') return entity.full_name;
  if (entity.owner?.login && entity.name) return `${entity.owner.login}/${entity.name}`;
  return '';
}

export function assertTrustedRun(run, expected) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    throw new Error('GitHub Actions run payload is missing');
  }
  if (parseRunId(run.id, 'run.id') !== expected.runId) {
    throw new Error(`Run ID ${run.id} does not match selected run ${expected.runId}`);
  }
  const repository = repoFullName(run.repository).toLowerCase();
  const headRepository = repoFullName(run.head_repository).toLowerCase();
  const expectedRepo = expected.repository.toLowerCase();
  if (repository !== expectedRepo) {
    throw new Error(`Run repository "${repository}" does not match "${expected.repository}"`);
  }
  if (headRepository !== expectedRepo) {
    throw new Error(`Run head repository "${headRepository || '(missing)'}" does not match "${expected.repository}"`);
  }
  if (run.path !== expected.workflowPath) {
    throw new Error(`Run workflow path "${run.path}" does not match "${expected.workflowPath}"`);
  }
  if (run.name !== expected.workflowName) {
    throw new Error(`Run workflow name "${run.name}" does not match "${expected.workflowName}"`);
  }
  if (FORBIDDEN_SOURCE_EVENTS.includes(run.event)) {
    throw new Error(`Rejected untrusted source event "${run.event}"`);
  }
  if (!expected.allowedEvents.includes(run.event)) {
    throw new Error(`Rejected source event "${run.event}"; allowed: ${expected.allowedEvents.join(', ')}`);
  }
  if (run.head_branch !== expected.branch) {
    throw new Error(`Rejected source branch "${run.head_branch}"; expected "${expected.branch}"`);
  }
  if (run.status !== 'completed') {
    throw new Error(`Source run ${run.id} is not completed (status "${run.status}")`);
  }
  if (run.conclusion !== 'success') {
    throw new Error(`Source run ${run.id} conclusion is "${run.conclusion}", not success`);
  }
  const headSha = normalizeSha(run.head_sha, 'run.head_sha');
  return {
    runId: expected.runId,
    targetSha: headSha,
    workflowPath: run.path,
    headBranch: run.head_branch,
    event: run.event,
  };
}

async function getRun(ctx, runId) {
  const payload = await githubJson(
    ctx.fetchImpl,
    repoUrl(ctx.apiBase, ctx.repository, `/actions/runs/${runId}`),
    ctx.token,
  );
  return assertTrustedRun(payload, {
    runId,
    repository: ctx.repository,
    workflowPath: ctx.workflowPath,
    workflowName: ctx.workflowName,
    allowedEvents: ctx.allowedEvents,
    branch: ctx.branch,
  });
}

function workflowFileName(workflowPath) {
  return workflowPath.slice(workflowPath.lastIndexOf('/') + 1);
}

async function findSuccessfulRunForSha(ctx, sha) {
  const fileName = workflowFileName(ctx.workflowPath);
  const url = repoUrl(
    ctx.apiBase,
    ctx.repository,
    `/actions/workflows/${encodeURIComponent(fileName)}/runs?head_sha=${encodeURIComponent(sha)}&status=completed&per_page=100`,
  );
  const payload = await githubJson(ctx.fetchImpl, url, ctx.token);
  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
  const matching = [];
  for (const run of runs) {
    try {
      matching.push(
        assertTrustedRun(run, {
          runId: parseRunId(run.id, 'run.id'),
          repository: ctx.repository,
          workflowPath: ctx.workflowPath,
          workflowName: ctx.workflowName,
          allowedEvents: ctx.allowedEvents,
          branch: ctx.branch,
        }),
      );
    } catch {
      // List filters are not proof; only a later GET of a selected ID is.
    }
  }
  const exact = matching.filter((run) => run.targetSha === sha);
  if (exact.length === 0) {
    throw new Error(`No successful ${ctx.workflowPath} run on ${ctx.branch} for ${sha}`);
  }
  exact.sort((a, b) => b.runId - a.runId);
  return getRun(ctx, exact[0].runId);
}

async function peelTag(ctx, tag) {
  const ref = await githubJson(
    ctx.fetchImpl,
    repoUrl(ctx.apiBase, ctx.repository, `/git/ref/tags/${encodeURIComponent(tag)}`),
    ctx.token,
  );
  if (ref?.ref !== `refs/tags/${tag}`) {
    throw new Error(`Tag ref for "${tag}" did not resolve to refs/tags/${tag}`);
  }
  const object = ref.object;
  if (!object || typeof object !== 'object') {
    throw new Error(`Tag "${tag}" is missing a git object`);
  }
  if (object.type === 'commit') {
    return normalizeSha(object.sha, `tag ${tag} commit`);
  }
  if (object.type !== 'tag') {
    throw new Error(`Tag "${tag}" points at unsupported object type "${object.type}"`);
  }
  const annotated = await githubJson(
    ctx.fetchImpl,
    repoUrl(ctx.apiBase, ctx.repository, `/git/tags/${normalizeSha(object.sha, `tag ${tag} object`)}`),
    ctx.token,
  );
  if (annotated?.object?.type !== 'commit') {
    throw new Error(`Annotated tag "${tag}" does not peel to a commit`);
  }
  return normalizeSha(annotated.object.sha, `tag ${tag} peeled commit`);
}

async function defaultBranchSha(ctx) {
  const ref = await githubJson(
    ctx.fetchImpl,
    repoUrl(ctx.apiBase, ctx.repository, `/git/ref/heads/${encodeURIComponent(ctx.branch)}`),
    ctx.token,
  );
  if (ref?.ref !== `refs/heads/${ctx.branch}`) {
    throw new Error(`Default branch ref did not resolve to refs/heads/${ctx.branch}`);
  }
  return normalizeSha(ref.object?.sha, `${ctx.branch} tip`);
}

async function packageVersionAt(ctx, sha) {
  const path = String(ctx.packageJsonPath ?? 'package.json').trim() || 'package.json';
  if (!PACKAGE_PATH_RE.test(path) || path.split('/').includes('..')) {
    throw new Error(`package-json-path must stay inside the repository: "${path}"`);
  }
  const payload = await githubJson(
    ctx.fetchImpl,
    repoUrl(
      ctx.apiBase,
      ctx.repository,
      `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(sha)}`,
    ),
    ctx.token,
  );
  if (payload?.encoding !== 'base64' || typeof payload.content !== 'string') {
    throw new Error(`Unable to read ${path} at ${sha}`);
  }
  const raw = Buffer.from(payload.content.replace(/\s+/g, ''), 'base64').toString('utf8');
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${path} at ${sha}`);
  }
  if (!VERSION_RE.test(String(pkg.version ?? ''))) {
    throw new Error(`${path} at ${sha} is missing a valid x.y.z version`);
  }
  return pkg.version;
}

function output(result) {
  return {
    'target-sha': result.targetSha,
    'source-run-id': String(result.sourceRunId),
    'event-type': result.eventType,
    'workflow-path': result.workflowPath ?? '',
    'head-branch': result.headBranch ?? '',
  };
}

export async function resolveReleaseSource(options) {
  const token = String(options.token ?? '').trim();
  if (!token) {
    throw new Error('A GitHub token with actions:read is required');
  }
  const callerEvent = String(options.callerEventName ?? '').trim();
  if (callerEvent && FORBIDDEN_SOURCE_EVENTS.includes(callerEvent)) {
    throw new Error(`Rejected caller event "${callerEvent}"`);
  }

  const sameRunProof = parseBoolean(options.sameRunProof, 'same-run-proof');
  const requireFreshMain = parseBoolean(options.requireFreshMain, 'require-fresh-main');
  const packageVersionMatch = parseBoolean(options.packageVersionMatch, 'package-version-match');
  const sourceRunIdRaw = String(options.sourceRunId ?? '').trim();
  const tag = normalizeTag(options.tag);
  const requestedSha = String(options.sourceSha ?? '').trim();
  const expectedSha = requestedSha ? normalizeSha(requestedSha, 'source-sha') : '';

  const ctx = {
    token,
    fetchImpl: options.fetchImpl ?? fetch,
    apiBase: String(options.apiBase ?? 'https://api.github.com').replace(/\/$/, ''),
    repository: normalizeRepository(options.repository),
    workflowPath: normalizeWorkflowPath(options.expectedWorkflowPath),
    workflowName: normalizeWorkflowName(options.expectedWorkflowName),
    allowedEvents: parseAllowedEvents(options.allowedSourceEvents),
    branch: normalizeBranch(options.expectedBranch ?? 'main'),
    packageJsonPath: options.packageJsonPath ?? 'package.json',
  };

  if (sameRunProof) {
    if (sourceRunIdRaw || tag) {
      throw new Error('same-run-proof cannot be combined with source-run-id or tag');
    }
    const githubSha = normalizeSha(options.githubSha, 'github.sha');
    if (!expectedSha) {
      throw new Error('same-run-proof requires source-sha from the successful needs jobs');
    }
    if (expectedSha !== githubSha) {
      throw new Error('same-run-proof source-sha does not match github.sha');
    }
    const runId = parseRunId(options.githubRunId, 'github.run_id');
    return output({
      targetSha: expectedSha,
      sourceRunId: runId,
      eventType: 'same-run',
      workflowPath: ctx.workflowPath,
      headBranch: '',
    });
  }

  if (!sourceRunIdRaw && !tag) {
    throw new Error('Provide source-run-id, tag, or same-run-proof; refusing github.sha and latest-green fallback');
  }

  let proven;
  if (sourceRunIdRaw) {
    proven = await getRun(ctx, parseRunId(sourceRunIdRaw));
    if (tag) {
      const taggedSha = await peelTag(ctx, tag);
      if (taggedSha !== proven.targetSha) {
        throw new Error(`Tag "${tag}" commit ${taggedSha} does not match run ${proven.runId} SHA ${proven.targetSha}`);
      }
    }
    if (requireFreshMain && !tag) {
      const tip = await defaultBranchSha(ctx);
      if (tip !== proven.targetSha) {
        throw new Error(`Stale deploy: run SHA ${proven.targetSha} is not the current ${ctx.branch} tip ${tip}`);
      }
    }
  } else {
    const taggedSha = await peelTag(ctx, tag);
    proven = await findSuccessfulRunForSha(ctx, taggedSha);
    if (proven.targetSha !== taggedSha) {
      throw new Error(`Selected run ${proven.runId} SHA ${proven.targetSha} does not match tag commit ${taggedSha}`);
    }
  }

  if (expectedSha && expectedSha !== proven.targetSha) {
    throw new Error(`source-sha ${expectedSha} does not match proven SHA ${proven.targetSha}`);
  }

  if (packageVersionMatch) {
    if (!tag || !VERSION_TAG_RE.test(tag)) {
      throw new Error('package-version-match requires a vX.Y.Z tag');
    }
    const version = await packageVersionAt(ctx, proven.targetSha);
    if (version !== tag.slice(1)) {
      throw new Error(`Tag ${tag} does not match package.json version ${version} at ${proven.targetSha}`);
    }
  }

  return output({
    targetSha: proven.targetSha,
    sourceRunId: proven.runId,
    eventType: tag && !sourceRunIdRaw ? 'tag' : 'run',
    workflowPath: proven.workflowPath,
    headBranch: proven.headBranch,
  });
}

export function writeGitHubOutput(outputs, outputFile) {
  if (!outputFile) {
    throw new Error('GITHUB_OUTPUT is not set');
  }
  for (const [name, value] of Object.entries(outputs)) {
    if (String(value).includes('\n')) {
      throw new Error(`Refusing multiline output ${name}`);
    }
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
}

export async function runCli(env = process.env, fetchImpl = fetch) {
  const resolved = await resolveReleaseSource({
    token: env.GITHUB_TOKEN,
    repository: env.GITHUB_REPOSITORY,
    githubSha: env.GITHUB_SHA,
    githubRunId: env.GITHUB_RUN_ID,
    apiBase: env.GITHUB_API_URL,
    expectedWorkflowPath: env.RELEASE_EXPECTED_WORKFLOW_PATH,
    expectedWorkflowName: env.RELEASE_EXPECTED_WORKFLOW_NAME,
    allowedSourceEvents: env.RELEASE_ALLOWED_SOURCE_EVENTS,
    expectedBranch: env.RELEASE_EXPECTED_BRANCH,
    sourceRunId: env.RELEASE_SOURCE_RUN_ID,
    sourceSha: env.RELEASE_SOURCE_SHA,
    tag: env.RELEASE_TAG,
    sameRunProof: env.RELEASE_SAME_RUN_PROOF,
    requireFreshMain: env.RELEASE_REQUIRE_FRESH_MAIN,
    packageVersionMatch: env.RELEASE_PACKAGE_VERSION_MATCH,
    packageJsonPath: env.RELEASE_PACKAGE_JSON_PATH,
    callerEventName: env.RELEASE_CALLER_EVENT_NAME,
    fetchImpl,
  });
  writeGitHubOutput(resolved, env.GITHUB_OUTPUT);
  console.log(
    `Resolved release source ${resolved['target-sha']} (${resolved['event-type']}) run ${resolved['source-run-id']}`,
  );
  return resolved;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(`Release source error: ${error.message}`);
    process.exitCode = 1;
  });
}
