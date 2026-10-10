import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
async function markdown(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdown(target));
    else if (entry.name.endsWith('.md')) files.push(target);
  }
  return files;
}

test('link matcher recognizes real Markdown and rejects missing targets', async () => {
  const matches = [...'[example](<missing-document.md>)'.matchAll(/\]\(<([^>]+)>\)/g)];
  assert.equal(matches.length, 1);
  assert.equal(matches[0][1], 'missing-document.md');
  await assert.rejects(access(path.join(root, matches[0][1])), { code: 'ENOENT' });
});

test('current repository documentation relative links resolve', async () => {
  const files = [...await markdown(path.join(root, 'docs')), ...['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md'].map(file => path.join(root, file))];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/\]\(<([^>]+)>\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      await assert.doesNotReject(access(path.resolve(path.dirname(file), decodeURIComponent(target))), `${path.relative(root, file)}: ${target}`);
    }
  }
});

test('release uses current version-specific notes rather than generated commit chatter', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const notes = await readFile(path.join(root, 'docs/releases', `${pkg.version}.md`), 'utf8');
  for (const heading of ['本版变化', '安装或升级', '需要知道的限制', '验证范围']) assert.ok(notes.includes(`## ${heading}`));
  const workflow = await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.ok(workflow.includes('--notes-file'));
  assert.ok(!workflow.includes('--generate-notes'));
});
