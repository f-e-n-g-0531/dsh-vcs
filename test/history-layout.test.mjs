import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('history review uses scoped rows, a grid form and collapsed explanatory help',async()=>{
 const history=await readFile(new URL('../src/HistoryPanel.jsx',import.meta.url),'utf8');
 const details=await readFile(new URL('../src/CommitDetails.jsx',import.meta.url),'utf8');
 const css=await readFile(new URL('../src/style.css',import.meta.url),'utf8');
 assert.ok(history.includes('className="vcs-history-search"'));
 assert.ok(history.includes('<details className="vcs-help"><summary>'));
 assert.ok(history.includes('className="vcs-commit-list"'));
 assert.ok(history.includes('className="vcs-commit-meta"'));
 assert.ok(details.includes('className="vcs-commit-files"'));
 assert.ok(details.includes('title={file.oldPath?'));
 assert.ok(css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
 assert.ok(css.includes('.vcs-root .vcs-commit-files>li+li'));
});
