import React,{useState} from 'react';
import TextComparison from './TextComparison.jsx';
import {comparisonLabels} from './comparison-labels.mjs';
import {useHistoryEditor} from './useHistoryEditor.mjs';
export default function HistoryViewer({comparison,identity,t,single=false,line=null}){
 const [sideBySide,setSide]=useState(true),[ignoreWhitespace,setWhitespace]=useState(false),[wrap,setWrap]=useState(false);
 const [enabled,setEnabled]=useState(true);
 const {node,viewer,ready,error}=useHistoryEditor({comparison,identity,enabled,single,line,sideBySide,ignoreWhitespace,wrap});
 return <div>
 <button aria-pressed={enabled} onClick={()=>setEnabled(value=>!value)}>{t(enabled?'historyBasic':'historyAdvanced')}</button>
 {ready&&!single&&<div key="controls" style={{display:'flex',flexWrap:'wrap',gap:8}}>
 <button aria-pressed={sideBySide} onClick={()=>setSide(v=>!v)}>{t(sideBySide?'side':'inline')}</button>
 <label><input type="checkbox" checked={ignoreWhitespace} onChange={e=>setWhitespace(e.target.checked)}/>{t('whitespace')}</label>
 <label><input type="checkbox" checked={wrap} onChange={e=>setWrap(e.target.checked)}/>{t('wrap')}</label>
 <button onClick={()=>viewer.current?.navigate('previous')}>{t('previous')}</button>
 <button onClick={()=>viewer.current?.navigate('next')}>{t('next')}</button>
 </div>}
 {enabled&&!ready&&!error&&<p role="status">{t('loading')}</p>}
 {error&&<p role="status">{t('fallback')} {error}</p>}
 <div key="editor-host" style={{position:'relative',height:360}}>
 <div ref={node} style={{position:'absolute',inset:0,visibility:ready?'visible':'hidden'}} aria-hidden={!ready}/>
 {!ready&&<TextComparison comparison={comparison} labels={comparisonLabels(t)}/>}
 </div></div>;
}
