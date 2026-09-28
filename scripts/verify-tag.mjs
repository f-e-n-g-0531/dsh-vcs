import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const tag=process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert.match(tag || '', /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Expected version tag vX.Y.Z');
assert.equal(tag,'v'+pkg.version,'Version tag must match package.json');
console.log('Verified release tag:',tag);
