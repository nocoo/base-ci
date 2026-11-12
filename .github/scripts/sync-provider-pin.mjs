#!/usr/bin/env node
/**
 * Align every internal nocoo/base-ci action pin with .github/internal-provider-pin.txt.
 * Release maintainers: set the pin file to a reachable full SHA, then run this before tagging.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const pinPath = join(root, '.github/internal-provider-pin.txt');
const pin = readFileSync(pinPath, 'utf8').trim().split(/\s+/)[0];
assert.match(pin, /^[a-f0-9]{40}$/);
execFileSync('git', ['cat-file', '-e', `${pin}^{commit}`], { cwd: root, stdio: 'pipe' });

const pattern = /(nocoo\/base-ci\/\.github\/actions\/[a-z0-9-]+@)[a-f0-9]{40}/g;
let total = 0;
for (const file of readdirSync(join(root, '.github/workflows'))) {
  if (!file.endsWith('.yml')) continue;
  const path = join(root, '.github/workflows', file);
  const text = readFileSync(path, 'utf8');
  const next = text.replace(pattern, `$1${pin}`);
  if (next !== text) {
    writeFileSync(path, next);
    total += 1;
  }
}
writeFileSync(pinPath, `${pin}\n`);
console.log(`synced provider pin ${pin} across ${total} workflow file(s)`);
