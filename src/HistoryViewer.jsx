import React,{useEffect,useRef,useState} from 'react';
import TextComparison from './TextComparison.jsx';
import {comparisonLabels} from './comparison-labels.mjs';
import {startHistoryEditor} from './history-editor.mjs';
import {loadEditor} from './editor-loader.mjs';
import {version} from '../package.json';
export default function HistoryViewer({comparison,identity,t}){
 const node=useRef(null);
 const [enabled,setEnabled]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  setReady(false);setError('');if(!enabled)return;
  const asset=name=>new URL('vcs-assets/'+name,document.baseURI).href;
  const link=document.createElement('link');link.rel='stylesheet';link.href=asset('editor.css');node.current.parentNode.appendChild(link);
  const task=startHistoryEditor({node:node.current,comparison,key:identity,load:signal=>loadEditor(asset('editor.js')+'?v='+encodeURIComponent(version),{signal}),onReady:()=>setReady(true),onError:e=>setError(e.message)});
  return()=>{try{task.dispose();}finally{link.remove();}};
 },[enabled,comparison,identity]);
 return <div>
 <button aria-pressed={enabled} onClick={()=>setEnabled(value=>!value)}>{t(enabled?'historyBasic':'historyAdvanced')}</button>
 {enabled&&!ready&&!error&&<p role="status">{t('loading')}</p>}
 {error&&<p role="status">{t('fallback')} {error}</p>}
 <div style={{position:'relative',height:360}}>
 <div ref={node} style={{position:'absolute',inset:0,visibility:ready?'visible':'hidden'}} aria-hidden={!ready}/>
 {!ready&&<TextComparison comparison={comparison} labels={comparisonLabels(t)}/>}
 </div></div>;
}
