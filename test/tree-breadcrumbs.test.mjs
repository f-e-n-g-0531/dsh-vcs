import test from 'node:test';
import assert from 'node:assert/strict';
import {treeBreadcrumbs} from '../src/tree-filter.mjs';
test('tree breadcrumbs retain exact ancestor paths including root',()=>{
 assert.deepEqual(treeBreadcrumbs(),[{path:'',name:'/'}]);
 assert.deepEqual(treeBreadcrumbs('a/b'),[{path:'',name:'/'},{path:'a',name:'a'},{path:'a/b',name:'b'}]);
});
test('tree breadcrumbs do not decode trim or normalize Git names',()=>{
 const names=[' spaced ','中文','%2F','back\\slash','<img>'];
 assert.deepEqual(treeBreadcrumbs(names.join('/')).slice(1),names.map((name,i)=>({name,path:names.slice(0,i+1).join('/')})));
});
