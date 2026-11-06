import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('line copy distinguishes independent operations readonly phases and captured content from fresh revalidation',async()=>{const locales=JSON.parse(await readFile('src/locales.json','utf8'));for(const language of ['zh','en']){for(const key of ['lineReadonly','lineSemantics','lineWarningStage','lineWarningUnstage'])assert.equal(typeof locales[language][key],'string');assert.match(locales[language].lineWarningStage,language==='zh'?/I → W/:/I → W/);assert.match(locales[language].lineWarningUnstage,/I → H/);for(const key of ['lineWarningStage','lineWarningUnstage'])for(const word of ['blob','GC','HEAD'])assert.ok(locales[language][key].includes(word));}});
