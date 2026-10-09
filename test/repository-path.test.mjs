import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inside, confined} from '../repository-path.mjs';

test('lexical containment distinguishes siblings from descendants', () => {
  const root = path.resolve('repository');
  assert.equal(inside(root, root), true);
  assert.equal(inside(root, path.join(root, 'nested', 'file')), true);
  assert.equal(inside(root, root + '-sibling'), false);
  assert.equal(inside(root, path.dirname(root)), false);
});

test('confinement permits missing children but rejects unsafe addresses', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vcs-path-'));
  try {
    await mkdir(path.join(root, 'nested'));
    assert.equal(await confined(root, 'nested/missing/file'), path.join(root, 'nested', 'missing', 'file'));
    for (const relative of ['../outside', path.resolve(root, '..', 'outside'), 'C:relative', 'bad' + String.fromCharCode(0)]) {
      await assert.rejects(confined(root, relative), /Invalid repository path|Path escapes repository/);
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
