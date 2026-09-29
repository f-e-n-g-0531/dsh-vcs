import React, {useState,useEffect,useRef,useSyncExternalStore} from 'react';
import css from './style.css';
import TextComparison from './TextComparison.jsx';
import {loadEditor} from './editor-loader.mjs';
import dictionaries from './locales.json';
import {reviewShortcut} from './review-keyboard.mjs';
import {version} from '../package.json';
import {readProject,saveProject} from './project-preference.mjs';
import {changeKey,repositoryLabel,requestMode,groupChanges,changePosition,adjacentChange,directoryAncestors,treeDirectoryIds,countChangeStatuses,buildChangeTree,createStatusLimiter,mergeDiscovery,selectProject} from './repositories.mjs';
const statusCodes={modified:'M',added:'A',deleted:'D',missing:'D',renamed:'R',copied:'C',conflicted:'U',untracked:'?',unversioned:'?',replaced:'M',obstructed:'U',normal:'P'};
const asset = name => new URL('vcs-assets/'+name,document.baseURI).href;
function Icon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16M6 10h3M7.5 8.5v3M15 14h3"/></svg>}
export const inject=['slots','layout','locale','connection','uiSession'];
export function apply(ctx){
  ctx.effect(()=>ctx.locale.register('local.vcs',dictionaries));
  const t=ctx.locale.bind('local.vcs');
  const scheduleStatus=createStatusLimiter(2);
  async function rpc(endpoint,payload,signal){const result=await ctx.connection.rpc.call('/vcs-rpc',endpoint,payload,signal);if(!result.ok){const error=new Error(result.error?.message||String(result.error||t('error')));error.code=result.error?.code;throw error;}return result.value;}
  function Page(props){
    const session=props.useSessions(s=>Object.values(s.byId).find(row=>(row.retainedBy.mainView??0)>0));
    return <PanelBoundary key={JSON.stringify([session?.id,session?.cwd])}><Panel session={session}/></PanelBoundary>;
  }
  class PanelBoundary extends React.Component {
    state={error:null};
    static getDerivedStateFromError(error){return {error};}
    render(){return this.state.error?<section className="vcs-root"><style>{css}</style><div className="vcs-message vcs-error">{t('error')}<button onClick={()=>this.setState({error:null})}>{t('retry')}</button><button onClick={()=>ctx.layout.selectPanel(null)}>{t('back')}</button></div></section>:this.props.children;}
  }
  function Panel({session}) {
    useSyncExternalStore(fn=>ctx.locale.subscribe(fn),()=>ctx.locale.getSnapshot(),()=>ctx.locale.getSnapshot());
    const sessionId=session?.id;
    const [mode,setMode]=useState('all'),[refresh,setRefresh]=useState(0),[discovery,setDiscovery]=useState(null),[statuses,setStatuses]=useState({}),[repositoryId,setRepositoryId]=useState(()=>readProject(session?.cwd)),[scan,setScan]=useState(0),[subdirectory,setSubdirectory]=useState(''),[scanPath,setScanPath]=useState(''),[selected,setSelected]=useState(null),[comparison,setComparison]=useState(null);
    const [scanning,setScanning]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[detailError,setDetailError]=useState(''),[editorError,setEditorError]=useState(''),[copiedPath,setCopiedPath]=useState(false);
    const [query,setQuery]=useState(''),[statusFilter,setStatusFilter]=useState('all'),[tree,setTree]=useState(true),[collapsedDirectories,setCollapsedDirectories]=useState({}),[sideBySide,setSide]=useState(true),[ignoreWhitespace,setWhitespace]=useState(false),[wrap,setWrap]=useState(false),[tab,setTab]=useState('content');
    const [editorRetry,setEditorRetry]=useState(0);
    const [stats,setStats]=useState({added:0,deleted:0,count:0}),[editorReady,setEditorReady]=useState(false);
    const panelNode=useRef(null),editorNode=useRef(null),viewer=useRef(null),fileListNode=useRef(null),searchNode=useRef(null),revealChange=useRef(null);
    const statusController=useRef(null),compareController=useRef(null),scanController=useRef(null),previousDiscovery=useRef(null),preserveStatusRefresh=useRef(false),rediscovering=useRef(false);
    const repositories=discovery?.repositories||[];
    const visibleRepositories=repositories.filter(repo=>repo.id===repositoryId);
    useEffect(()=>{if(repositories.some(repo=>repo.id===repositoryId))saveProject(session?.cwd,repositoryId);},[session?.cwd,repositoryId,discovery]);
    const invalidate=()=>{statusController.current?.abort();compareController.current?.abort();setComparison(null);setSelected(null);setDetailError('');setTab('content');setStats({added:0,deleted:0,count:0});};
    const rescan=()=>{rediscovering.current=false;invalidate();scanController.current?.abort();previousDiscovery.current=discovery;setDiscovery(null);setStatuses({});setScanPath(subdirectory.trim());setScan(x=>x+1);};
    const rediscover=()=>{if(rediscovering.current)return;rediscovering.current=true;invalidate();scanController.current?.abort();previousDiscovery.current=null;setDiscovery(null);setStatuses({});setScanPath('');setScan(x=>x+1);};
    const refreshStatuses=(preserve=false)=>{preserveStatusRefresh.current=preserve;if(!preserve)invalidate();if(!preserve)setStatuses({});setRefresh(x=>x+1);};
    useEffect(()=>{
      const controller=new AbortController();scanController.current=controller;setError('');setScanning(!!sessionId);
      if(sessionId)rpc('vcs/repositories',{sessionId,...(scanPath?{subdirectory:scanPath}:{})},controller.signal).then(value=>{
        if(!controller.signal.aborted){const next=mergeDiscovery(previousDiscovery.current,value,scanPath);rediscovering.current=false;setRepositoryId(previous=>selectProject(next.repositories,previous));setDiscovery(next);}
      }).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setScanning(false);});
      return()=>controller.abort();
    },[sessionId,scan,scanPath]);
    useEffect(()=>{
      const controller=new AbortController(),preserve=preserveStatusRefresh.current;statusController.current=controller;preserveStatusRefresh.current=false;
      if(!preserve){setStatuses({});setDetailError('');}
      for(const repository of visibleRepositories){
        const modeForRepo=requestMode(repository,mode);
        scheduleStatus(()=>rpc('vcs/status',{sessionId,repositoryId:repository.id,mode:modeForRepo},controller.signal),controller.signal).then(value=>{
          if(!controller.signal.aborted)setStatuses(old=>({...old,[repository.id]:{...value,mode:modeForRepo}}));
        }).catch(e=>{if(controller.signal.aborted)return;if(e.code==='vcs/rediscover-required'){rediscover();return;}setStatuses(old=>({...old,[repository.id]:{error:e.message,changes:[],mode:modeForRepo}}));});
      }
      return()=>controller.abort();
    },[sessionId,discovery,repositoryId,mode,refresh]);
    useEffect(()=>{const focus=()=>{if(document.visibilityState==='visible')refreshStatuses(true);};window.addEventListener('focus',focus);const poll=window.setInterval(focus,30000);return()=>{window.removeEventListener('focus',focus);window.clearInterval(poll);};},[sessionId,repositoryId,mode]);
    const selectedRepository=repositories.find(repo=>repo.id===selected?.repositoryId);
    const selectedStatus=selected?statuses[selected.repositoryId]:null;
    useEffect(()=>{
      const controller=new AbortController();compareController.current=controller;setComparison(null);setDetailError('');setStats({added:0,deleted:0,count:0});setTab('content');setLoading(!!selected&&!!selectedStatus);
      if(selected&&selectedStatus&&selectedRepository)rpc('vcs/compare',{sessionId,repositoryId:selected.repositoryId,mode:requestMode(selectedRepository,mode),id:selected.id},controller.signal).then(value=>{if(!controller.signal.aborted)setComparison(value);}).catch(e=>{if(controller.signal.aborted)return;if(e.code==='vcs/rediscover-required'){rediscover();return;}setDetailError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
      return()=>controller.abort();
    },[selected,selectedStatus,sessionId,mode]);
    useEffect(()=>{
      let disposed=false;let instance;const controller=new AbortController();setEditorReady(false);setEditorError('');
      const link=document.createElement('link');link.rel='stylesheet';link.href=asset('editor.css');editorNode.current.parentNode.appendChild(link);
      loadEditor(asset('editor.js')+'?v='+encodeURIComponent(version)+'&retry='+editorRetry,{signal:controller.signal}).then(module=>{if(disposed)return;instance=module.createDiff(editorNode.current,{onStats:setStats});viewer.current=instance;setEditorReady(true);}).catch(e=>{if(!disposed)setEditorError(e.message);});
      return()=>{disposed=true;controller.abort();instance?.dispose();viewer.current=null;link.remove();};
    },[editorRetry]);
    useEffect(()=>{if(editorReady&&comparison&&!comparison.binary)viewer.current?.setContent(comparison,JSON.stringify([sessionId,discovery?.cwd,selected?.repositoryId,mode,selected?.id,comparison.path]));},[editorReady,comparison,sessionId,discovery,selected,mode]);
    useEffect(()=>{viewer.current?.options({sideBySide,ignoreWhitespace,wrap});},[editorReady,sideBySide,ignoreWhitespace,wrap]);
    const groups=groupChanges(visibleRepositories,statuses,query,statusFilter);
    const changes=groups.flatMap(group=>group.changes);
    const statusCounts=countChangeStatuses(selectedStatus?.changes);
    const reviewPosition=changePosition(changes,selected?.id);
    const clearFilters=()=>{setQuery('');setStatusFilter('all');};
    const copyPath=async()=>{const value=comparison?.path||chosen?.path;if(!value)return;try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);else {const input=document.createElement('textarea');try{input.value=value;input.style.cssText='position:fixed;opacity:0';document.body.appendChild(input);input.select();if(!document.execCommand('copy'))throw Error('copy failed');}finally{input.remove();}}setCopiedPath(true);window.setTimeout(()=>setCopiedPath(false),1500);}catch{setDetailError(t('copyFailed'));}};
    useEffect(()=>{const keydown=e=>{const action=reviewShortcut(e,panelNode.current,searchNode.current,!!query);if(!action)return;e.preventDefault();if(action==='search'){searchNode.current?.focus();searchNode.current?.select();}else if(action==='clear')setQuery('');else selectAdjacent(action);};window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown);},[query,changes,selected]);
    const setTreeExpanded=expanded=>setCollapsedDirectories(old=>{const next={...old};for(const group of groups)for(const id of treeDirectoryIds(buildChangeTree(group.changes)))next[group.repository.id+'\0'+id]=!expanded;return next;});
    const revealSelected=()=>{const entry=chosen;if(!entry||!selected)return;setTree(true);clearFilters();setCollapsedDirectories(old=>{const next={...old};for(const directory of directoryAncestors(entry.path))next[selected.repositoryId+'\0'+directory]=false;return next;});revealChange.current=changeKey(selected.repositoryId,entry.id);};
    useEffect(()=>{const key=revealChange.current;if(!key)return;const item=[...(fileListNode.current?.querySelectorAll('button[data-vcs-change]')||[])].find(node=>node.dataset.vcsChange===key);if(item){item.scrollIntoView({block:'nearest'});item.focus();revealChange.current=null;}},[tree,query,statusFilter,collapsedDirectories,groups]);
    const selectAdjacent=direction=>{const next=adjacentChange(changes,selected?.id,direction);if(next){compareController.current?.abort();setComparison(null);setTab('content');setSelected({repositoryId,id:next.id});}};
    const busy=scanning||visibleRepositories.some(repo=>!statuses[repo.id]);
    const chosen=selectedStatus?.changes?.find(c=>c.id===selected?.id);
    const properties=comparison?.properties;
    const propertyNames=properties?[...new Set([...Object.keys(properties.left||{}),...Object.keys(properties.right||{})])].filter(k=>properties.left?.[k]!==properties.right?.[k]):[];
    const code=entry=>statusCodes[entry?.status]||entry?.status?.slice(0,1).toUpperCase()||'M';
    const binarySummary=comparison?.binary?[comparison.left.label,comparison.right.label].filter(Boolean).join(' ↔ '):'';
    const overlay=detailError||(loading?t('loading'):!sessionId?t('noSession'):busy&&!chosen?t('loading'):error?error:!repositories.length?t('noRepo'):!chosen?t('pick'):comparison?.binary?t('binary')+(binarySummary?' '+t('binaryComparison',{files:binarySummary}):''):!comparison?t('pick'):!editorReady&&!editorError?t('loading'):'');
    const onFileListKeyDown=e=>{const node=fileListNode.current,items=node?[...node.querySelectorAll('button[data-vcs-item]')]:[],index=items.indexOf(e.target);if(index<0)return;let next;if(e.key==='ArrowDown')next=items[index+1];else if(e.key==='ArrowUp')next=items[index-1];else if(e.key==='Home')next=items[0];else if(e.key==='End')next=items.at(-1);else if(e.key==='ArrowRight'&&e.target.dataset.vcsDirectory==='closed'){e.preventDefault();e.target.click();return;}else if(e.key==='ArrowLeft'&&e.target.dataset.vcsDirectory==='open'){e.preventDefault();e.target.click();return;}else return;e.preventDefault();next?.focus();};
    const FileRow=({entry,compact=false,depth=0})=>{const slash=entry.path.lastIndexOf('/');return <button className="vcs-file" data-vcs-item data-vcs-change={changeKey(repositoryId,entry.id)} aria-current={selected?.repositoryId===repositoryId&&selected?.id===entry.id?'true':undefined} style={{paddingInlineStart:8+depth*14}} title={(entry.oldPath?entry.oldPath+' → ':'')+entry.path+' · '+t(code(entry))} onClick={()=>{compareController.current?.abort();setComparison(null);setTab('content');setSelected({repositoryId,id:entry.id});}}><span className="vcs-status" data-status={code(entry)}>{code(entry)}</span><span className="vcs-filename">{compact?entry.path.slice(slash+1):entry.path}{entry.oldPath&&<small className="vcs-filepath">← {entry.oldPath}</small>}</span></button>;};
    const TreeRows=({node,repository,depth=0})=><>{node.directories.map(directory=>{const key=repository.id+'\0'+directory.id,closed=!!collapsedDirectories[key];return <React.Fragment key={key}><button className="vcs-dir vcs-dir-toggle" data-vcs-item data-vcs-directory={closed?'closed':'open'} aria-expanded={!closed} style={{paddingInlineStart:8+depth*14}} onClick={()=>setCollapsedDirectories(old=>({...old,[key]:!closed}))}><span aria-hidden="true">{closed?'›':'⌄'}</span>{directory.name}<small>{directory.count}</small></button>{!closed&&<TreeRows node={directory} repository={repository} depth={depth+1}/>}</React.Fragment>;})}{node.files.map(entry=><FileRow key={changeKey(repository.id,entry.id)} entry={entry} compact={node.id!==''} depth={depth}/>)}</>;
    return <section ref={panelNode} className="vcs-root" aria-label={t('title')}><style>{css}</style>
      <header className="vcs-top"><Icon/><h1 className="vcs-title">{t('title')}</h1><span className="vcs-badge">{t('readonly')}</span><span className="vcs-spacer"/>
        <select aria-label={t('repositories')} value={repositoryId} disabled={scanning||!repositories.length} onChange={e=>{invalidate();setStatuses({});setRepositoryId(e.target.value);}}>{!repositories.length&&<option value="">{t('repositories')}</option>}{repositories.map(repo=><option key={repo.id} value={repo.id}>{repositoryLabel(repo,t('workspaceRoot'))}</option>)}</select>
        <label className="vcs-mode">{t('gitMode')} <select aria-label={t('gitMode')} value={mode} disabled={!visibleRepositories.some(repo=>repo.type==='git')} onChange={e=>{invalidate();setStatuses({});setMode(e.target.value);}}>{['all','unstaged','staged'].map(m=><option key={m} value={m}>{t(m)}</option>)}</select></label>
        <button onClick={refreshStatuses} disabled={busy||!sessionId}>{t('refresh')}</button><button onClick={()=>ctx.layout.selectPanel(null)}>{t('back')}</button>
        <div className="vcs-path" title={discovery?.cwd||session?.cwd}>{t('session')}: {discovery?.cwd||session?.cwd||'—'}</div>
        <form className="vcs-discovery" onSubmit={e=>{e.preventDefault();rescan();}}><input aria-label={t('subdirectory')} placeholder={t('subdirectory')} value={subdirectory} onChange={e=>setSubdirectory(e.target.value)}/><button disabled={!sessionId||scanning}>{t('rescan')}</button><span>{t('scanHint')}</span></form>
        {discovery?.truncated&&<div className="vcs-notice">{t('truncated')}</div>}{(discovery?.warnings||[]).map((warning,index)=><div className="vcs-notice" key={index}>{typeof warning==='string'?warning:warning.message||JSON.stringify(warning)}</div>)}
      </header>
      <div className="vcs-body"><aside className="vcs-files"><div className="vcs-filter"><input ref={searchNode} aria-label={t('search')} placeholder={t('search')} title={t('searchShortcut')} value={query} onChange={e=>setQuery(e.target.value)}/>{(query||statusFilter!=='all')&&<button className="vcs-clear-filter" onClick={clearFilters}>{t('clearFilters')}</button>}</div><div className="vcs-status-filter" aria-label={t('filterStatus')}>{['all','modified','added','deleted','renamed','conflicted','untracked'].map(value=><button key={value} aria-pressed={statusFilter===value} onClick={()=>setStatusFilter(value)}>{value==='all'?t('allFiles'):t(statusCodes[value]||'M')} <small>{statusCounts[value]||0}</small></button>)}</div><div className="vcs-count"><span>{changes.length} {t('files')}</span><span className="vcs-auto">{t('autoRefresh')}</span><button aria-pressed={tree} onClick={()=>setTree(!tree)}>{t(tree?'tree':'list')}</button></div>{tree&&<div className="vcs-tree-actions"><button onClick={()=>setTreeExpanded(true)}>{t('expandAll')}</button><button onClick={()=>setTreeExpanded(false)}>{t('collapseAll')}</button><button onClick={revealSelected} disabled={!chosen}>{t('revealSelected')}</button></div>}<nav className="vcs-filelist" aria-label={t('title')} ref={fileListNode} onKeyDown={onFileListKeyDown}>
        {groups.map(group=>{const repo=group.repository;return <section className="vcs-repository" key={repo.id} aria-label={repositoryLabel(repo,t('workspaceRoot'))}><div className="vcs-repository-heading" title={repo.root}><strong>{repositoryLabel(repo,t('workspaceRoot'))}</strong><small>{repo.type==='svn'?t('svnBase'):t(requestMode(repo,mode))}</small></div>
          {group.error?<div className="vcs-message vcs-error" role="status">{group.error}<button onClick={rescan}>{t('rescan')}</button></div>:!statuses[repo.id]?<div className="vcs-message">{t('loading')}</div>:tree?<TreeRows node={buildChangeTree(group.changes)} repository={repo}/>:group.changes.map(entry=><FileRow key={changeKey(repo.id,entry.id)} entry={entry}/>)}
          {!group.error&&statuses[repo.id]&&!group.changes.length&&<div className="vcs-message">{query?t('emptySearch'):t('clean')}</div>}
        </section>;})}{!groups.length&&<div className="vcs-message">{scanning?t('loading'):error||(!sessionId?t('noSession'):t('noRepo'))}{error&&<button onClick={rescan}>{t('rescan')}</button>}</div>}
      </nav></aside>
      <main className="vcs-detail"><div className="vcs-filehead"><strong title={comparison?.path||chosen?.path}>{selectedRepository?repositoryLabel(selectedRepository,t('workspaceRoot'))+' / ':''}{comparison?.path||chosen?.path||t('pick')}</strong><button className="vcs-copy-path" disabled={!(comparison?.path||chosen?.path)} onClick={copyPath}>{t(copiedPath?'copied':'copyPath')}</button>{copiedPath&&<span className="vcs-sr-only" role="status">{t('pathCopied')}</span>}<span className="vcs-spacer"/>{comparison&&!comparison.binary&&editorReady&&<><span className="vcs-add">+{stats.added}</span><span className="vcs-del">−{stats.deleted}</span></>}</div>
        {editorError&&<div className="vcs-notice" role="status">{t('fallback')} <button onClick={()=>setEditorRetry(x=>x+1)}>{t('retry')}</button><details><summary>{t('diagnostics')}</summary>{editorError}</details></div>}
        {comparison&&<div className="vcs-context" aria-label={t('comparisonContext')}><span className="vcs-context-status" data-status={code(comparison)}>{t(code(comparison))}</span>{comparison.oldPath&&<span className="vcs-context-rename" title={comparison.oldPath+' → '+comparison.path}>{comparison.oldPath} <b>→</b> {comparison.path}</span>}<span>{comparison.left.label||'—'} <b>↔</b> {comparison.right.label||'—'}</span>{(comparison.left.encoding||comparison.right.encoding)&&<span>{t('encoding')}: {comparison.left.encoding||'—'} / {comparison.right.encoding||'—'}</span>}</div>}
        {comparison?.notice&&<div className="vcs-notice">{comparison.notice}</div>}
        {propertyNames.length>0&&<div className="vcs-tabs">{['content','properties'].map(value=><button key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{t(value)}{value==='properties'?' ('+propertyNames.length+')':''}</button>)}</div>}
        <div className="vcs-labels"><span>{comparison?.left.label||'—'}{comparison?.left.encoding?' · '+comparison.left.encoding:''}</span><span>{comparison?.right.label||'—'}{comparison?.right.encoding?' · '+comparison.right.encoding:''}</span></div>
        <div className="vcs-editorbox" data-hidden={!!overlay||tab!=='content'} style={tab==='properties'?{display:'none'}:undefined}><div className="vcs-editor" ref={editorNode} style={editorError?{display:'none'}:undefined}/>{editorError&&comparison&&!comparison.binary&&!overlay&&<TextComparison comparison={comparison} labels={{approximate:t('approximate'),truncated:t('textTruncated')}}/>}{overlay&&<div className={'vcs-message '+((error||detailError||editorError)?'vcs-error':'')} role="status">{overlay}{(error||detailError||editorError)&&<button onClick={()=>editorError?setEditorRetry(x=>x+1):rescan()}>{t(editorError?'retry':'rescan')}</button>}</div>}</div>
        {tab==='properties'&&<div className="vcs-properties"><table><thead><tr><th>{t('properties')}</th><th>{comparison?.left.label||t('before')}</th><th>{comparison?.right.label||t('after')}</th></tr></thead><tbody>{propertyNames.map(name=><tr key={name}><th>{name}</th><td>{properties.left?.[name]??'—'}</td><td>{properties.right?.[name]??'—'}</td></tr>)}</tbody></table></div>}
        <footer className="vcs-toolbar"><button disabled={!editorReady} aria-pressed={sideBySide} onClick={()=>setSide(!sideBySide)}>{t(sideBySide?'side':'inline')}</button><label><input type="checkbox" disabled={!editorReady} checked={ignoreWhitespace} onChange={e=>setWhitespace(e.target.checked)}/>{t('whitespace')}</label><label><input type="checkbox" disabled={!editorReady} checked={wrap} onChange={e=>setWrap(e.target.checked)}/>{t('wrap')}</label><span className="vcs-spacer"/>{editorReady&&<span>{stats.count} {t('changes')}</span>}<button disabled={!editorReady||!comparison||!!overlay} onClick={()=>viewer.current?.navigate('previous')}>{t('previous')}</button><button disabled={!editorReady||!comparison||!!overlay} onClick={()=>viewer.current?.navigate('next')}>{t('next')}</button>{reviewPosition.index>0&&<span className="vcs-review-position">{t('reviewPosition',{index:reviewPosition.index,total:reviewPosition.total})}</span>}<span className="vcs-toolbar-separator"/><button title={t('fileShortcut')} disabled={!changes.length} onClick={()=>selectAdjacent('previous')}>{t('previousFile')}</button><button title={t('fileShortcut')} disabled={!changes.length} onClick={()=>selectAdjacent('next')}>{t('nextFile')}</button></footer>
      </main></div></section>;
  }
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'local-vcs'},Page));
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'local-vcs',label:()=>t('title'),order:65},Icon));
}
