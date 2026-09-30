import test from 'node:test';
import assert from 'node:assert/strict';
import {planSvnLog,planSvnDetail} from '../src/svn-log-plan.mjs';
import {parseSvnLogPage} from '../src/svn-log.mjs';
import {parseSvnDetail} from '../src/svn-detail.mjs';
const base={root:'https://example.test/repo',scope:'/scope',snapshot:'9007199254740993'};
test('SVN log plan pins peg independently of descending cursor and bounds lookahead',()=>{
 const plan=planSvnLog({...base,path:'/scope/a@%.txt',cursor:'9007199254740991',limit:100});
 assert.deepEqual(plan.args,['log','--xml','--stop-on-copy','--non-interactive','--no-auth-cache','--limit','101','-r','9007199254740991:0','--','https://example.test/repo/scope/a%40%25.txt@9007199254740993']);
 assert.equal(plan.snapshot,base.snapshot);assert.equal(planSvnLog(base).limit,50);
 assert.equal(planSvnLog({...base,snapshot:'0'}).args.at(-1),'https://example.test/repo/scope@0');
});
test('SVN log plan and response parser retain snapshot identity across sparse pages',()=>{
 const xml=values=>'<log>'+values.map(r=>'<logentry revision="'+r+'"/>').join('')+'</log>';
 const first=planSvnLog({...base,limit:2});
 const page=parseSvnLogPage(xml(['9007199254740993','9007199254740980','9']),first);
 assert.equal(page.nextRevision,'9007199254740979');
 const second=planSvnLog({...base,limit:2,cursor:page.nextRevision});
 assert.equal(second.args.at(-1),first.args.at(-1));assert.ok(second.args.includes('9007199254740979:0'));
 const tail=parseSvnLogPage(xml(['9','1']),second);
 assert.deepEqual([...page.entries,...tail.entries].map(e=>e.revision),['9007199254740993','9007199254740980','9','1']);assert.equal(tail.nextRevision,null);
 assert.throws(()=>parseSvnLogPage(xml(['9007199254740980']),second));
 assert.throws(()=>parseSvnLogPage(xml(['9','9']),second));
 assert.throws(()=>parseSvnLogPage(xml(['9','8','7','6']),second));
});
test('SVN detail plan binds selected revision and parser while retaining snapshot peg',()=>{
 const plan=planSvnDetail({...base,revision:'9'});
 assert.deepEqual(plan.args,['log','--xml','--verbose','--stop-on-copy','--non-interactive','--no-auth-cache','--limit','1','-r','9:9','--','https://example.test/repo/scope@9007199254740993']);
 assert.equal(parseSvnDetail('<log><logentry revision="9"><paths/></logentry></log>',plan).revision,'9');
 assert.throws(()=>parseSvnDetail('<log><logentry revision="8"/></log>',plan));
 for(const override of [{revision:'9007199254740994'},{revision:'HEAD'},{path:'/outside'},{snapshot:'BASE'}])assert.throws(()=>planSvnDetail({...base,revision:'9',...override}));
});
test('SVN log plan rejects outside paths and invalid revision or page bounds',()=>{
 for(const override of [{path:'/scope-other/a'},{path:'/scope/../a'},{snapshot:'HEAD'},{cursor:'9007199254740994'},{limit:0},{limit:101},{limit:1.5},{limit:'2'},{root:'file:///repo'}])assert.throws(()=>planSvnLog({...base,...override}));
});
