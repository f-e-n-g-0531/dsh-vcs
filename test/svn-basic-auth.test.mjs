import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {createSvnRuntime} from '../src/svn-runtime.mjs';
import {createSvnRpc} from '../src/svn-rpc.mjs';
import {createSvnDavLogTransport} from '../src/svn-dav-log-transport.mjs';
import {createBoundedHttps} from '../src/bounded-https.mjs';
import {readHostBasicCredentials} from '../src/svn-https-host.mjs';

const fixture = name => readFileSync(new URL('./fixtures/svn-dav-' + name + '.xml', import.meta.url));
const root = 'https://example.test/repo';
const identity = {cwd:'/wc', root, scope:'/', uuid:'d524e65f-a581-4edd-8084-716aaa8cf531', revision:'2'};
const address = {sessionId:'local', repositoryId:'svn'};
const env = {DSH_VCS_SVN_BASIC_ROOT:root, DSH_VCS_SVN_BASIC_UUID:identity.uuid,
  DSH_VCS_SVN_BASIC_SESSION:address.sessionId, DSH_VCS_SVN_BASIC_USERNAME:'fixture', DSH_VCS_SVN_BASIC_PASSWORD:'only:fixture'};
const header = 'Basic ' + Buffer.from('fixture:only:fixture').toString('base64');

test('host-scoped Basic authenticates DAV discovery, baseline and REPORT only after explicit choice', async t => {
  const calls = [];
  let now = 0;
  let invalid = false;
  const request = createBoundedHttps({request(url, options, callback) {
    const sent = options.headers.Authorization;
    calls.push({url:url.href, method:options.method, sent});
    assert.equal(options.rejectUnauthorized, true);
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter();
      res.statusCode = sent === header && !invalid ? 200 : 401;
      res.headers = sent ? {} : {'www-authenticate':'Basic realm="Repo"'};
      res.complete = true;
      res.destroy = () => {};
      callback(res);
      if (res.statusCode === 200) {
        res.emit('data', options.method === 'REPORT' ? fixture('log') : options.headers.Label ? Buffer.from(fixture('baseline').toString()
          .replaceAll('/bln/0','/bln/2').replaceAll('/bc/0/','/bc/2/').replace('<lp1:version-name>0','<lp1:version-name>2')) : fixture('discovery'));
        res.emit('end');
      }
      req.emit('close');
    });
    return req;
  }});
  const runtime = createSvnRuntime({now:()=>now, resolveIdentity:async()=>identity,
    readBasicCredentials:(value, secret)=>readHostBasicCredentials(value, secret, env),
    readCachedCredential:async realm=>{assert.equal(realm,'<https://example.test:443> Repo');return {username:'fixture',password:'only:fixture'};},
    transportFormat:'dav', transport:createSvnDavLogTransport({request})});
  t.after(()=>runtime.dispose());
  const rpc = createSvnRpc(runtime);
  const call = (method, options={}, scope=address) => rpc('vcs/svn-'+method, {...scope,...options});
  const describe = async scope => (await call('describe',{},scope)).value;
  const approve = (offer, options={}, scope=address) => call('approve',{offer:offer.offer,explicit:true,...options},scope);
  const log = grant => call('log',{token:grant.token,snapshot:grant.snapshot});
  const offer = await describe();
  assert.equal(offer.basicAuthEnabled,true);
  assert.equal(JSON.stringify(offer).includes(env.DSH_VCS_SVN_BASIC_PASSWORD),false);
  const other = {...address,sessionId:'other'};
  const otherOffer = await describe(other);
  assert.equal(otherOffer.basicAuthEnabled,undefined);
  assert.equal((await approve(otherOffer,{useBasic:true},other)).ok,false);
  assert.equal((await approve(offer,{basic:{username:'browser',password:'reject'}})).ok,false);
  const guest = (await approve(offer)).value;
  assert.equal(calls.length,0);
  assert.equal((await log(guest)).error.code,'vcs/svn-auth-required');
  assert.equal(calls[0].sent,undefined);
  assert.equal((await log(guest)).error.code,'vcs/svn-consent-required');
  const authenticated = (await approve(await describe(),{useBasic:true})).value;
  const history = await log(authenticated);
  assert.equal(history.ok,true);
  assert.deepEqual(history.value.entries.map(item=>item.revision),['2','1','0']);
  assert.deepEqual(calls.slice(1).map(c=>[c.method,c.sent]),[['PROPFIND',header],['PROPFIND',header],['REPORT',header]]);
  assert.ok(calls.every(c=>c.url.startsWith(root+'/')));
  const ownerCall=(method,options)=>rpc('vcs/svn-'+method,{...address,...options},undefined,true);
  assert.equal((await describe()).cachedLoginEnabled,undefined);
  const cacheOffer=(await ownerCall('describe')).value;
  assert.equal(cacheOffer.cachedLoginEnabled,true);
  assert.equal((await approve(cacheOffer,{useCachedLogin:true})).ok,false);
  const cached=(await ownerCall('approve',{offer:cacheOffer.offer,explicit:true,useCachedLogin:true})).value;
  const beforeCached=calls.length;
  assert.equal((await log(cached)).ok,false);
  assert.equal(calls.length,beforeCached);
  assert.equal((await ownerCall('log',{token:cached.token,snapshot:cached.snapshot})).ok,true);
  assert.deepEqual(calls.slice(beforeCached).map(c=>c.sent),[undefined,header,undefined,header,undefined,header]);
  // Selecting a new mode replaces the previous grant for this working copy.
  const current=(await approve(await describe(),{useBasic:true})).value;
  invalid = true;
  assert.equal((await log(current)).error.code,'vcs/svn-auth-required');
  assert.equal((await log(current)).error.code,'vcs/svn-consent-required');
  const expiring = (await approve(await describe(),{useBasic:true})).value;
  now = 300000;
  const before = calls.length;
  assert.equal((await log(expiring)).error.code,'vcs/svn-consent-required');
  assert.equal(calls.length,before);
});

test('Basic request primitive rejects a different origin and sibling repository before opening a socket', async () => {
  const request = createBoundedHttps({request(){assert.fail('request must not open');}});
  for (const url of ['https://different.test/repo/a',root+'-sibling/a',root+'/a?other=1']) {
    await assert.rejects(request(url,{origin:new URL(url).origin,authentication:{root,header}}),/outside|Invalid/);
  }
});
