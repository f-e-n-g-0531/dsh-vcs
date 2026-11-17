import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('project MIT license matches package metadata and retains third-party notices', async()=>{
 const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
 const pkg=JSON.parse(await read('package.json')),lock=JSON.parse(await read('package-lock.json'));
 assert.equal(pkg.license,'MIT');
 assert.equal(lock.packages[''].license,'MIT');
 const license=await read('LICENSE');
 assert.match(license,/^MIT License/);
 assert.match(license,/Copyright \(c\) 2026 f-e-n-g-0531 and contributors/);
 for(const text of ['Permission is hereby granted, free of charge','sublicense, and/or sell','The above copyright notice and this permission notice','THE SOFTWARE IS PROVIDED "AS IS"','AUTHORS OR COPYRIGHT HOLDERS'])assert.ok(license.includes(text),text);
 for(const file of ['README.md','CONTRIBUTING.md','docs/INSTALL.md'])assert.ok((await read(file)).includes('MIT License'),file);
 const notices=await read('THIRD_PARTY_NOTICES.md');
 assert.ok(notices.includes('Copyright (c) 2016 - present Microsoft Corporation'));
 assert.ok(notices.includes('Third-party materials remain under their respective licenses'));
});
