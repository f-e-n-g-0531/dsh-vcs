import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHistoryGraph} from '../src/history-graph.mjs';
import {assignGraphLanes} from '../src/graph-lanes.mjs';
const id=n=>n.toString(16).padStart(40,'0');
const node=(n,parents)=>({id:id(n),parents:parents.map(id)});
test('swimlanes preserve first parent and distinct fork before join',()=>{
 const graph=buildHistoryGraph([node(1,[2,3]),node(2,[4]),node(3,[4]),node(4,[])]),lanes=assignGraphLanes(graph);
 assert.deepEqual(lanes.nodes.map(n=>n.lane),[0,0,1,0]);assert.equal(lanes.edges.length,4);assert.equal(lanes.lanesTruncated,false);assert.deepEqual(assignGraphLanes(graph),lanes);
});
test('octopus graph stays at 32 lanes and preserves textual relations',()=>{
 const graph=buildHistoryGraph([node(1,Array.from({length:40},(_,i)=>i+2)),...Array.from({length:40},(_,i)=>node(i+2,[]))]),lanes=assignGraphLanes(graph);
 assert.equal(lanes.lanesTruncated,true);assert.ok(lanes.laneCount<=32);assert.equal(graph.edges.length,40);assert.ok(lanes.edges.length<40);assert.equal(lanes.nodes.length,41);
});
test('missing parents remain boundaries not invented lanes',()=>{
 const lanes=assignGraphLanes(buildHistoryGraph([node(1,[2])]));assert.equal(lanes.edges.length,0);assert.equal(lanes.laneCount,1);
});
