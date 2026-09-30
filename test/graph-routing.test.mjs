import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHistoryGraph} from '../src/history-graph.mjs';
import {routeGraphEdges} from '../src/graph-routing.mjs';
const id=n=>n.toString(16).padStart(40,'0');
test('graph routes separate overlapping intervals and reuse completed lanes',()=>{
 const commits=[{id:id(1),parents:[id(3),id(4)]},{id:id(2),parents:[id(3)]},{id:id(3),parents:[]},{id:id(4),parents:[]},{id:id(5),parents:[id(6)]},{id:id(6),parents:[id(7)]}];
 const graph=buildHistoryGraph(commits),before=structuredClone(graph),routes=routeGraphEdges(graph);
 assert.deepEqual(routes.map(r=>r.lane),[0,1,2,0]);assert.deepEqual(graph,before);
 for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++)if(routes[i].lane===routes[j].lane)assert.ok(routes[i].end<routes[j].start);
 assert.deepEqual(routeGraphEdges(buildHistoryGraph([])),[]);
});
