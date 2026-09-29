import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHistoryGraph} from '../src/history-graph.mjs';
const id=n=>n.toString(16).padStart(40,'0');
test('graph preserves merge parents and marks unloaded parents without fabricating nodes',()=>{
 const input=[{id:id(4),parents:[id(3),id(2)]},{id:id(3),parents:[id(1)]},{id:id(2),parents:[id(1)]}];
 const before=JSON.stringify(input),g=buildHistoryGraph(input);
 assert.equal(g.nodes.length,3);assert.deepEqual(g.edges.map(e=>e.missing),[false,false,true,true]);assert.equal(g.nodesTruncated,false);assert.equal(g.edgesTruncated,false);assert.equal(JSON.stringify(input),before);
 assert.deepEqual(buildHistoryGraph([]).nodes,[]);assert.equal(buildHistoryGraph([{id:id(1),parents:[]}]).edges.length,0);
});
test('graph caps nodes and edges and marks parents beyond projection as missing',()=>{
 const commits=Array.from({length:201},(_,n)=>({id:id(n+1),parents:[id(n+2)]}));const g=buildHistoryGraph(commits);
 assert.equal(g.nodes.length,200);assert.equal(g.nodesTruncated,true);assert.equal(g.edges.at(-1).missing,true);
 const wide=buildHistoryGraph([{id:id(1),parents:Array.from({length:1001},(_,n)=>id(n+2))}]);assert.equal(wide.edges.length,1000);assert.equal(wide.edgesTruncated,true);
});
test('graph rejects duplicate invalid cyclic and non-topological nodes',()=>{
 for(const input of [null,[{id:'HEAD',parents:[]}],[{id:id(1),parents:[id(1)]}],[{id:id(1),parents:[]},{id:id(1),parents:[]}],[{id:id(1),parents:[]},{id:id(2),parents:[id(1)]}],[{id:id(1),parents:[id(2),id(2)]}]])assert.throws(()=>buildHistoryGraph(input));
 const sha='a'.repeat(64);assert.equal(buildHistoryGraph([{id:sha,parents:[]}]).nodes[0].id,sha);
});
