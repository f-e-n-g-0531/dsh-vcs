import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('SVN has an explicit history view separate from the workspace',async()=>{
 const source=await readFile('src/client.jsx','utf8');
 assert.ok(source.includes("const historyActive=(gitSelected||svnSelected)&&reviewView==='history'"));
 assert.ok(source.includes('historyActive&&svnSelected&&<SvnRemote'));
 assert.ok(source.includes('historyActive&&gitSelected&&<HistoryPanel'));
 assert.ok(source.includes('hidden={reviewActive}'));
 const remote=await readFile('src/SvnRemote.jsx','utf8');
 assert.ok(remote.includes('!grant ? <SvnConsent'));
 const history=await readFile('src/SvnHistory.jsx','utf8');
 for(const name of ['vcs-history-browser','vcs-commit-sidebar','vcs-commit-summary','vcs-commit-picker','vcs-commit-comparison']) assert.ok(history.includes(name));
 assert.ok(history.includes("rpc('vcs/svn-detail'"));
 assert.ok(!history.includes("rpc('vcs/compare'"));
});
