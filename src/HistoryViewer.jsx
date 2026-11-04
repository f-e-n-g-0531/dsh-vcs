import React,{useState} from 'react';
import TextComparison from './TextComparison.jsx';
import {comparisonLabels} from './comparison-labels.mjs';
import {useHistoryEditor} from './useHistoryEditor.mjs';
export default function HistoryViewer({comparison,identity,t,single=false,line=null,startLine=1,emptyLine=false,initialOptions,onOptionsChange}){
 const [sideBySide,setSide]=useState(initialOptions?.sideBySide!==false),[ignoreWhitespace,setWhitespace]=useState(initialOptions?.ignoreWhitespace===true),[wrap,setWrap]=useState(initialOptions?.wrap===true);
 const [enabled,setEnabled]=useState(initialOptions?.enabled!==false);
 const report=patch=>onOptionsChange?.({sideBySide,ignoreWhitespace,wrap,enabled,...patch});
 const {node,viewer,ready,error,computation}=useHistoryEditor({comparison,identity,enabled,single,startLine,line:single&&Number.isSafeInteger(line)&&line>=startLine?line-startLine+1:null,sideBySide,ignoreWhitespace,wrap});
 return <div className="vcs-history-viewer"><div className="vcs-history-viewer-toolbar">
 <button aria-pressed={enabled} onClick={()=>{setEnabled(!enabled);report({enabled:!enabled});}}>{t(enabled?'historyBasic':'historyAdvanced')}</button>
 {ready&&!single&&<div key="controls" style={{display:'flex',flexWrap:'wrap',gap:8}}>
 <button aria-pressed={sideBySide} onClick={()=>{setSide(!sideBySide);report({sideBySide:!sideBySide});}}>{t(sideBySide?'side':'inline')}</button>
 <label><input type="checkbox" checked={ignoreWhitespace} onChange={e=>{setWhitespace(e.target.checked);report({ignoreWhitespace:e.target.checked});}}/>{t('whitespace')}</label>
 <label><input type="checkbox" checked={wrap} onChange={e=>{setWrap(e.target.checked);report({wrap:e.target.checked});}}/>{t('wrap')}</label>
 <button onClick={()=>viewer.current?.navigate('previous')}>{t('previous')}</button>
 <button onClick={()=>viewer.current?.navigate('next')}>{t('next')}</button>
 </div>}</div>
 {enabled&&!ready&&!error&&<p role="status">{t('loading')}</p>}
 {comparison.large&&!single&&ready&&<p role="status">{t(computation==='complete'?'diffComplete':computation==='incomplete'?'diffIncomplete':'diffPending')}</p>}
 {comparison.large&&!ready&&<p role="status">{t('largeFallback')}</p>}
 {error&&<p role="status">{t('fallback')} {error}</p>}
 <div key="editor-host" className="vcs-history-editor-host" style={{position:'relative',height:'var(--vcs-history-editor-height, 360px)'}}>
 <div ref={node} style={{position:'absolute',inset:0,visibility:ready?'visible':'hidden'}} aria-hidden={!ready}/>
 {!ready&&<TextComparison comparison={comparison} single={single} line={line} startLine={startLine} emptyLine={emptyLine} labels={{...comparisonLabels(t),singleReadonly:t('readingReadonly'),window:t('readingWindow'),targetMissing:t('readingTargetMissing'),previous:t('previous'),next:t('next')}}/>}
 </div></div>;
}
