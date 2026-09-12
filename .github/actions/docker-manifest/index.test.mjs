import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectManifest, validateImages } from './index.mjs';

const sha = 'a'.repeat(40);
const images = [
  { service: 'web', image: 'ghcr.io/nocoo/ellie-web', 'build-args': 'APP=web' },
  { service: 'admin', image: 'ghcr.io/nocoo/ellie-admin', 'build-args': 'APP=admin' },
];
const records = images.map(({ service, image }, i) => ({
  service, image, sourceSha: sha, digest: `sha256:${String(i).repeat(64)}`,
}));

test('releases both images with exact source and digests, independent of completion order', () => {
  assert.deepEqual(collectManifest(images, sha, [...records].reverse()), records);
  assert.equal(validateImages(images, sha)[0].file, 'Dockerfile');
});

test('rejects partial, duplicate and unexpected build results', () => {
  assert.throws(() => collectManifest(images, sha, records.slice(0, 1)), /Incomplete/);
  assert.throws(() => collectManifest(images, sha, [records[0], records[0]]), /Expected one/);
  assert.throws(() => collectManifest(images, sha, [...records, records[0]]), /Incomplete/);
});

test('rejects mismatched source, repository or unverified digest', () => {
  for (const change of [
    { sourceSha: 'b'.repeat(40) },
    { image: 'ghcr.io/other/ellie-web' },
    { digest: 'latest' },
  ]) {
    assert.throws(() => collectManifest(images, sha, [{ ...records[0], ...change }, records[1]]));
  }
});

test('rejects ambiguous matrix entries and unsafe paths', () => {
  for (const change of [
    { service: 'web; echo unsafe' },
    { image: 'ghcr.io/nocoo/ellie-web:latest' },
    { file: '../Dockerfile' },
    { context: '/tmp/source' },
  ]) {
    assert.throws(() => validateImages([{ ...images[0], ...change }], sha));
  }
  assert.throws(() => validateImages([images[0], images[0]], sha), /Duplicate/);
  assert.throws(() => validateImages(images, 'main'), /full tested/);
  assert.throws(() => validateImages([], sha), /At least/);
});
