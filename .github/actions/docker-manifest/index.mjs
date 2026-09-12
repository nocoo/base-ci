import assert from 'node:assert/strict';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateImages(images, sha) {
  assert.match(sha, /^[a-f0-9]{40}$/, 'A full tested source SHA is required');
  assert.ok(Array.isArray(images) && images.length > 0, 'At least one image is required');
  const services = new Set();
  const names = new Set();
  return images.map((entry) => {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry));
    assert.match(entry.service ?? '', /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Invalid Compose service');
    assert.match(entry.image ?? '', /^ghcr\.io\/[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_./-]*$/, 'Use an untagged GHCR image');
    assert.ok(!services.has(entry.service), 'Duplicate Compose service');
    assert.ok(!names.has(entry.image), 'Duplicate image');
    services.add(entry.service);
    names.add(entry.image);
    const image = { context: '.', file: 'Dockerfile', 'build-args': '', ...entry };
    for (const key of ['context', 'file']) {
      assert.equal(typeof image[key], 'string');
      assert.ok(image[key] && !isAbsolute(image[key]) && !image[key].split(/[\\/]/).includes('..'), `${key} must stay inside the repository`);
    }
    assert.equal(typeof image['build-args'], 'string');
    return image;
  });
}

export function collectManifest(images, sha, records) {
  const expected = validateImages(images, sha);
  assert.equal(records.length, expected.length, 'Incomplete image manifest');
  const result = [];
  for (const image of expected) {
    const matches = records.filter((record) => record.service === image.service);
    assert.equal(matches.length, 1, `Expected one digest for ${image.service}`);
    const record = matches[0];
    assert.equal(record.image, image.image, 'Image does not match build plan');
    assert.equal(record.sourceSha, sha, 'Image was built from a different source');
    assert.match(record.digest ?? '', /^sha256:[a-f0-9]{64}$/, 'A full image digest is required');
    result.push({ service: image.service, image: image.image, digest: record.digest, sourceSha: sha });
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sha = process.env.RELEASE_SOURCE_SHA ?? '';
  const images = validateImages(JSON.parse(process.env.RELEASE_IMAGES), sha);
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ image: images })}\n`);
  const directory = process.env.RELEASE_MANIFEST_DIRECTORY;
  if (directory) {
    const records = readdirSync(directory).filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')));
    const manifest = collectManifest(images, sha, records);
    appendFileSync(process.env.GITHUB_OUTPUT, `release-images=${JSON.stringify(manifest)}\n`);
  }
}
