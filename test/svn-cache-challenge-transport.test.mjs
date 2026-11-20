import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createBoundedHttps} from '../src/bounded-https.mjs';
import {createSvnCacheChallengeRequest} from '../src/svn-cache-challenge-transport.mjs';

const root='https://svn.example.test/repo', origin=new URL(root).origin;
function fixture({challenge='Basic realm="Repo"',reject=false,onRead}={}) {
  const calls=[], realms=[];
  const transport=createBoundedHttps({request(url,opts,callback){
    const auth=opts.headers.Authorization;
    calls.push({url:url.href,auth});
    const req=new EventEmitter();
    req.destroy=()=>{};
    req.end=()=>queueMicrotask(()=>{
      const res=new EventEmitter();
      res.destroy=()=>{};
      res.statusCode=auth&&!reject?200:401;
      res.headers=auth?{}:{'www-authenticate':challenge};
      res.complete=true;
      callback(res);
      if(res.statusCode===200){res.emit('data',Buffer.from('history'));res.emit('end');}
      req.emit('close');
    });
    return req;
  }});
  const request=createSvnCacheChallengeRequest({root,request:transport,assertAuthorized:async()=>{},readCredential:async realm=>{
    realms.push(realm); onRead?.(); return {username:'fixture',password:'synthetic'};
  }});
  return {request,calls,realms};
}

test('only the exact Basic challenge permits a same-URL authenticated retry',async()=>{
  const {request,calls,realms}=fixture();
  assert.equal((await request(root+'/a',{origin})).toString(),'history');
  assert.deepEqual(realms,['<https://svn.example.test:443> Repo']);
  assert.deepEqual(calls,[{url:root+'/a',auth:undefined},{url:root+'/a',auth:'Basic '+Buffer.from('fixture:synthetic').toString('base64')}]);
  for(const url of [origin+'/repo-other/a','https://other.example.test/repo/a'])await assert.rejects(request(url,{origin}));
  assert.equal(calls.length,2);
});

test('unsupported challenge and rejected credentials fail without looping or reporting realm',async()=>{
  const a=fixture({challenge:'Digest realm="opaque"'});
  await assert.rejects(a.request(root,{origin}),{code:'vcs/svn-auth-required',message:'SVN cached login unavailable or rejected'});
  assert.equal(a.calls.length,1);assert.deepEqual(a.realms,[]);
  const b=fixture({reject:true});
  await assert.rejects(b.request(root,{origin}),{code:'vcs/svn-auth-required'});
  assert.equal(b.calls.length,2);assert.equal(b.realms.length,1);
});

test('cancel after credential lookup prevents the authenticated request',async()=>{
  const controller=new AbortController();
  const {request,calls}=fixture({onRead:()=>controller.abort()});
  await assert.rejects(request(root,{origin,signal:controller.signal}),{name:'AbortError'});
  assert.deepEqual(calls,[{url:root,auth:undefined}]);
});
