import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PACKAGE_FILES} from '../scripts/package-contract.mjs';

test('shipped Markdown local links remain inside distribution closure', async () => {
  const packed = new Set(PACKAGE_FILES);
  for (const file of PACKAGE_FILES.filter(file => file.endsWith('.md'))) {
    const text = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    for (const match of text.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)) {
      const target = match[1] || match[2];
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const relative = decodeURIComponent(target.split('#')[0]);
      if (!relative) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), relative));
      assert.ok(packed.has(resolved), file + ' links unshipped file: ' + target);
    }
  }
});
