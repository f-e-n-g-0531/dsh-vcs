import test from 'node:test';
import assert from 'node:assert/strict';
import {planSvnLog} from '../src/svn-log-plan.mjs';
const base={root:'https://example.test/repo',scope:'/scope',snapshot:'9007199254740993'};
test('SVN log plan pins peg independently of descending cursor and bounds lookahead',()=>{
 const plan=planSvnLog({...base,path:'/scope/a@%.txt',cursor:'9007199254740991',limit:100});
 assert.deepEqual(plan.args,['log','--xml','--stop-on-copy','--non-interactive','--no-auth-cache','--limit','101','-r','9007199254740991:0','--','https://example.test/repo/scope/a%40%25.txt@9007199254740993']);
 assert.equal(plan.snapshot,base.snapshot);assert.equal(planSvnLog(base).limit,50);
 assert.equal(planSvnLog({...base,snapshot:'0'}).args.at(-1),'https://example.test/repo/scope@0');
});
test('SVN log plan rejects outside paths and invalid revision or page bounds',()=>{
 for(const override of [{path:'/scope-other/a'},{path:'/scope/../a'},{snapshot:'HEAD'},{cursor:'9007199254740994'},{limit:0},{limit:101},{limit:1.5},{limit:'2'},{root:'file:///repo'}])assert.throws(()=>planSvnLog({...base,...override}));
});
