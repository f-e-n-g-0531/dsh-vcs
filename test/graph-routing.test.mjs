import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHistoryGraph} from '../src/history-graph.mjs';
import {routeGraphEdges} from '../src/graph-routing.mjs';
const id=n=>n.toString(16).padStart(40,'0');
test('dense bounded graph routes are deterministic and never share overlapping tracks',()=>{
 const commits=Array.from({length:201},(_,i)=>({id:id(i+1),parents:Array.from({length:200-i},(_,j)=>id(i+j+2))}));
 const graph=buildHistoryGraph(commits),routes=routeGraphEdges(graph);
 assert.equal(graph.nodes.length,200);assert.equal(graph.edges.length,1000);
 assert.equal(graph.nodesTruncated,true);assert.equal(graph.edgesTruncated,true);
 assert.deepEqual(routeGraphEdges(graph),routes);
 assert.equal(routes.length,graph.edges.filter(e=>!e.missing).length);
 const ends=new Map();
 for(const route of routes){
  assert.ok(Number.isInteger(route.lane)&&route.lane>=0&&route.lane<1000);
  assert.ok(route.start<route.end&&route.end<200);
  if(ends.has(route.lane))assert.ok(ends.get(route.lane)<route.start);
  ends.set(route.lane,route.end);
 }
});
test('missing parents stay metadata-only for SHA256 graph identities',()=>{
 const hash=n=>n.toString(16).padStart(64,'0');
 const graph=buildHistoryGraph([{id:hash(1),parents:[hash(2),hash(3)]},{id:hash(2),parents:[hash(4)]}]);
 const routes=routeGraphEdges(graph);
 assert.equal(routes.length,1);assert.equal(routes[0].to,hash(2));
 assert.equal(graph.edges.filter(e=>e.missing).length,2);
});
test('graph routes separate overlapping intervals and reuse completed lanes',()=>{
 const commits=[{id:id(1),parents:[id(3),id(4)]},{id:id(2),parents:[id(3)]},{id:id(3),parents:[]},{id:id(4),parents:[]},{id:id(5),parents:[id(6)]},{id:id(6),parents:[id(7)]}];
 const graph=buildHistoryGraph(commits),before=structuredClone(graph),routes=routeGraphEdges(graph);
 assert.deepEqual(routes.map(r=>r.lane),[0,1,2,0]);assert.deepEqual(graph,before);
 for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++)if(routes[i].lane===routes[j].lane)assert.ok(routes[i].end<routes[j].start);
 assert.deepEqual(routeGraphEdges(buildHistoryGraph([])),[]);
});
