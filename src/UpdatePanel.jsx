import React,{useEffect,useRef,useState} from 'react';
import {installUpdate} from './update-client.mjs';
import {PROTOCOL_VERSION,PACKAGE_NAME,stableVersion} from './update-protocol.mjs';
export default function UpdatePanel({rpc,manager,clientVersion,reloadBusy,onLock,onManager,t}){
 const [runtime,setRuntime]=useState(null),[info,setInfo]=useState(null),[busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[outcome,setOutcome]=useState(null),[confirmed,setConfirmed]=useState(false);
 const mounted=useRef(false),lock=useRef(false),task=useRef(null),terminal=!!outcome&&['restart-required','applied','unknown'].includes(outcome.state);
 useEffect(()=>{mounted.current=true;const c=new AbortController();task.current=c;rpc('vcs/runtime-info',{},c.signal).then(v=>{if(!c.signal.aborted)setRuntime(v);}).catch(e=>{if(!c.signal.aborted)setNotice(e.message);});return()=>{mounted.current=false;task.current?.abort();};},[]);
 const check=async()=>{if(lock.current||reloadBusy||terminal)return;lock.current=true;task.current?.abort();const c=new AbortController();task.current=c;setBusy('正在检查更新');setNotice('');setInfo(null);setConfirmed(false);try{const value=await rpc('vcs/check-update',{},c.signal);if(mounted.current&&!c.signal.aborted){if(value.packageName!==PACKAGE_NAME||!stableVersion(value.latestVersion)||!stableVersion(value.runningVersion)||value.protocol!==PROTOCOL_VERSION)throw Error('后台返回的版本信息无效');setInfo(value);setRuntime(value);setOutcome(null);}}catch(e){if(mounted.current&&!c.signal.aborted)setNotice(e.message);}finally{lock.current=false;if(mounted.current)setBusy('');}};
 const update=async()=>{if(lock.current||reloadBusy||!confirmed||!info||terminal)return;lock.current=true;setBusy('正在更新插件，请勿关闭页面');setNotice('');onLock(true);try{const result=await installUpdate(manager,info,{confirmed,requestId:crypto.randomUUID()});if(mounted.current){setOutcome(result);setConfirmed(false);}}catch(e){if(mounted.current)setNotice(e.message);}finally{lock.current=false;onLock(false);if(mounted.current)setBusy('');}};
 return <section style={{padding:12,flexShrink:0,maxHeight:'45%',overflow:'auto'}} aria-label={t('updatePlugin')}>
  <p>界面版本：{clientVersion} · 后台版本：{runtime?.runningVersion||'尚未读取'}</p>
  {runtime&&(runtime.runningVersion!==clientVersion||runtime.protocol!==PROTOCOL_VERSION)&&<p role="alert">界面与后台版本不一致。请刷新页面；若仍不一致，请手动重启 DSH。</p>}
  <button disabled={!!busy||reloadBusy||terminal} onClick={check}>检查更新</button> <button disabled={!!busy} onClick={onManager}>{t('updateManager')}</button>
  <a href={info?'https://github.com/f-e-n-g-0531/dsh-vcs/releases/tag/v'+info.latestVersion:'https://github.com/f-e-n-g-0531/dsh-vcs/releases/latest'} target="_blank" rel="noopener noreferrer">{t('updateRelease')}</a>
  {info&&!terminal&&<p>{info.available?'发现新版本 '+info.latestVersion:'当前运行版本没有更新的正式版本。'}</p>}
  {info?.available&&!terminal&&<><p>更新会修改当前 DSH 的插件安装环境。请先备份配置。更新已有插件可能需要手动重启，不会自动重启；不支持此接口时请到插件管理页面处理。</p><label><input type="checkbox" checked={confirmed} disabled={!!busy||reloadBusy} onChange={e=>setConfirmed(e.target.checked)}/> 我确认将此插件更新到 {info.latestVersion}</label><button disabled={!confirmed||!!busy||reloadBusy} onClick={update}>更新到 {info.latestVersion}</button></>}
  {busy&&<p role="status">{busy}<progress aria-label="更新进度"/></p>}{notice&&<p role="alert">{notice}</p>}{outcome&&<p role="status" data-update-state={outcome.state}>{outcome.message}</p>}
 </section>;
}
