import assert from 'node:assert/strict';
import test from 'node:test';

import { isFortyTwo } from '../src/check.mjs';

test('identifies the fixture value', () => {
  assert.equal(isFortyTwo('42'), true);
  assert.equal(isFortyTwo('41'), false);
});
