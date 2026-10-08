import React,{useEffect,useRef,useState} from 'react';
import TextComparison from './TextComparison.jsx';
import {comparisonLabels} from './comparison-labels.mjs';
import {startHistoryEditor} from './history-editor.mjs';
import {loadEditor} from './editor-loader.mjs';
import {version} from '../package.json';
export default function HistoryViewer({comparison,identity,t}){
 const node=useRef(null),viewer=useRef(null);
 const [sideBySide,setSide]=useState(true),[ignoreWhitespace,setWhitespace]=useState(false),[wrap,setWrap]=useState(false);
 const [enabled,setEnabled]=useState(true),[ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  setReady(false);setError('');if(!enabled)return;
  const asset=name=>new URL('vcs-assets/'+name,document.baseURI).href;
  const link=document.createElement('link');link.rel='stylesheet';link.href=asset('editor.css');node.current.parentNode.appendChild(link);
  const task=startHistoryEditor({node:node.current,comparison,key:identity,load:signal=>loadEditor(asset('editor.js')+'?v='+encodeURIComponent(version)+'&retry=0',{signal}),onReady:instance=>{viewer.current=instance;setReady(true);},onError:e=>setError(e.message)});
  return()=>{viewer.current=null;try{task.dispose();}finally{link.remove();}};
 },[enabled,comparison,identity]);
 useEffect(()=>{if(ready)viewer.current?.options({sideBySide,ignoreWhitespace,wrap});},[ready,sideBySide,ignoreWhitespace,wrap]);
 return <div>
 <button aria-pressed={enabled} onClick={()=>setEnabled(value=>!value)}>{t(enabled?'historyBasic':'historyAdvanced')}</button>
 {ready&&<div style={{display:'flex',flexWrap:'wrap',gap:8}}>
 <button aria-pressed={sideBySide} onClick={()=>setSide(v=>!v)}>{t(sideBySide?'side':'inline')}</button>
 <label><input type="checkbox" checked={ignoreWhitespace} onChange={e=>setWhitespace(e.target.checked)}/>{t('whitespace')}</label>
 <label><input type="checkbox" checked={wrap} onChange={e=>setWrap(e.target.checked)}/>{t('wrap')}</label>
 <button onClick={()=>viewer.current?.navigate('previous')}>{t('previous')}</button>
 <button onClick={()=>viewer.current?.navigate('next')}>{t('next')}</button>
 </div>}
 {enabled&&!ready&&!error&&<p role="status">{t('loading')}</p>}
 {error&&<p role="status">{t('fallback')} {error}</p>}
 <div style={{position:'relative',height:360}}>
 <div ref={node} style={{position:'absolute',inset:0,visibility:ready?'visible':'hidden'}} aria-hidden={!ready}/>
 {!ready&&<TextComparison comparison={comparison} labels={comparisonLabels(t)}/>}
 </div></div>;
}
