import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('review modes have one mutually-exclusive state and one cancellation transition',async()=>{
 const source=await readFile(new URL('../src/client.jsx',import.meta.url),'utf8');
 assert.ok(source.includes("[reviewView,setReviewView]=useState(initialView)"));
 for(const old of ['setHistoryOpen','setStashOpen','setGrepOpen'])assert.ok(!source.includes(old));
 for(const view of ['history','stash','grep'])assert.ok(source.includes("openReviewView('"+view+"')"));
 assert.ok(source.includes('[selected,selectedStatus,sessionId,mode,reviewActive,large,compareRetry]'));
 assert.ok(source.includes('const available=!!(!reviewActive&&selected&&selectedRepository&&selectedStatus?.changes?.some(change=>change.id===selected.id))'));
 assert.ok(source.includes("if(available)rpc('vcs/compare'"));
});
test('content search remounts its request owner when Session or repository changes',async()=>{
 const source=await readFile(new URL('../src/GrepPanel.jsx',import.meta.url),'utf8');
 assert.ok(source.includes('key={JSON.stringify([props.sessionId,props.repositoryId])}'));
 assert.ok(source.includes('useEffect(()=>()=>controller.current?.abort(),[])'));
});
