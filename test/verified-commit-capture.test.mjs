import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseVerifiedCommit} from '../src/verified-commit.mjs';
test('verified commit snapshots original Buffer before option getter mutation',()=>{const make=t=>Buffer.from('tree '+t.repeat(40)+'\nauthor T <t@x> 1 +0000\ncommitter T <t@x> 1 +0000\n\nm'),body=make('1'),replacement=make('2'),oid=createHash('sha1').update(Buffer.from('commit '+replacement.length+'\0')).update(replacement).digest('hex');assert.throws(()=>parseVerifiedCommit(body,{get oid(){replacement.copy(body);return oid;}}),/mismatch/);});
