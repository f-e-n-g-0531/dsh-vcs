import React, {useState,useEffect,useRef,useSyncExternalStore} from 'react';
import css from './style.css';
import {createClientRpc} from './client-rpc.mjs';
import {createStatusLimiter} from './status-limiter.mjs';
import TextComparison from './TextComparison.jsx';
import ImageComparison from './ImageComparison.jsx';
import ConflictStages from './ConflictStages.jsx';
import SubmoduleBadge from './SubmoduleBadge.jsx';
import {comparisonLabels} from './comparison-labels.mjs';
import SvnIdentity from './SvnIdentity.jsx';
import SvnRemote from './SvnRemote.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import StashPanel from './StashPanel.jsx';
import SearchPanel from './SearchPanel.jsx';
import {loadEditor} from './editor-loader.mjs';
import dictionaries from './locales.json';
import {reviewShortcut} from './review-keyboard.mjs';
import {handleFileListKeyDown} from './file-list-keyboard.mjs';
import {version} from '../package.json';
import {readProject,saveProject} from './project-preference.mjs';
import {changeKey,repositoryLabel,requestMode,groupChanges,changePosition,adjacentChange,directoryAncestors,treeDirectoryIds,countChangeStatuses,buildChangeTree,mergeDiscovery,selectProject} from './repositories.mjs';
const statusCodes={modified:'M',added:'A',deleted:'D',missing:'D',renamed:'R',copied:'C',conflicted:'U',untracked:'?',unversioned:'?',replaced:'M',obstructed:'U',normal:'P'};
const asset = name => new URL('vcs-assets/'+name,document.baseURI).href;
function Icon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16M6 10h3M7.5 8.5v3M15 14h3"/></svg>}
const changeCode=entry=>statusCodes[entry?.status]||entry?.status?.slice(0,1).toUpperCase()||'M';
export const inject=['slots','layout','locale','connection','uiSession'];
export {dictionaries};

// --- Hooks -----------------------------------------------------------------
// State is owned by the hook responsible for its lifecycle; the few values that
// several loaders reset together live in useWorkspaceSharedState.

// Shared workspace state: review mode, repository statuses, detail error and diff statistics.
function useWorkspaceSharedState(){
  const [mode,setMode]=useState('all'),[statuses,setStatuses]=useState({});
  const [detailError,setDetailError]=useState(''),[stats,setStats]=useState({added:0,deleted:0,count:0});
  return {mode,setMode,statuses,setStatuses,detailError,setDetailError,stats,setStats};
}

// Review view selection: workspace, history, stash or grep.
function useReviewView(initialView,onViewChange){
  const [reviewView,setReviewView]=useState(initialView);
  useEffect(()=>{onViewChange?.(reviewView);},[reviewView]);
  return [reviewView,setReviewView];
}

// Repository discovery, project selection, targeted rescan and rediscovery.
function useRepositoryDiscovery({session,rpc,invalidate,setStatuses}){
  const sessionId=session?.id;
  const [discovery,setDiscovery]=useState(null),[repositoryId,setRepositoryId]=useState(()=>readProject(session?.cwd));
  const [scan,setScan]=useState(0),[subdirectory,setSubdirectory]=useState(''),[scanPath,setScanPath]=useState('');
  const [scanning,setScanning]=useState(false),[error,setError]=useState('');
  const scanController=useRef(null),previousDiscovery=useRef(null),rediscovering=useRef(false);
  const repositories=discovery?.repositories||[];
  useEffect(()=>{if(repositories.some(repo=>repo.id===repositoryId))saveProject(session?.cwd,repositoryId);},[session?.cwd,repositoryId,discovery]);
  useEffect(()=>{
    const controller=new AbortController();scanController.current=controller;setError('');setScanning(!!sessionId);
    if(sessionId)rpc('vcs/repositories',{sessionId,...(scanPath?{subdirectory:scanPath}:{})},controller.signal).then(value=>{
      if(!controller.signal.aborted){const next=mergeDiscovery(previousDiscovery.current,value,scanPath);rediscovering.current=false;setRepositoryId(previous=>selectProject(next.repositories,previous));setDiscovery(next);}
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setScanning(false);});
    return()=>controller.abort();
  },[sessionId,scan,scanPath]);
  const rescan=()=>{rediscovering.current=false;invalidate();scanController.current?.abort();previousDiscovery.current=discovery;setDiscovery(null);setStatuses({});setScanPath(subdirectory.trim());setScan(x=>x+1);};
  const rediscover=()=>{if(rediscovering.current)return;rediscovering.current=true;invalidate();scanController.current?.abort();previousDiscovery.current=null;setDiscovery(null);setStatuses({});setScanPath('');setScan(x=>x+1);};
  return {discovery,repositories,repositoryId,setRepositoryId,scan,subdirectory,setSubdirectory,scanning,error,rescan,rediscover};
}

// Repository status loading, cancellation and the visible-window focus refresh.
function useStatusLoading({sessionId,rpc,scheduleStatus,discovery,repositoryId,mode,visibleRepositories,setStatuses,setDetailError,rediscover,invalidate}){
  const [refresh,setRefresh]=useState(0),[historyRefresh,setHistoryRefresh]=useState(0);
  const statusController=useRef(null),preserveStatusRefresh=useRef(false);
  const refreshStatuses=(preserve=false)=>{if(!preserve)setHistoryRefresh(x=>x+1);preserveStatusRefresh.current=preserve;if(!preserve)invalidate();if(!preserve)setStatuses({});setRefresh(x=>x+1);};
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
  useEffect(()=>{const focus=e=>{if(e.target===window&&sessionId&&repositoryId&&document.visibilityState==='visible')refreshStatuses(true);};window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[sessionId,repositoryId,mode]);
  const abortStatus=()=>statusController.current?.abort();
  return {refresh,historyRefresh,refreshStatuses,abortStatus};
}

// Selection, comparison loading, large-file retry and the shared reset transitions.
function useComparisonLoader({sessionId,rpc,discovery,repositories,statuses,mode,reviewActive,setDetailError,setStats,rediscover}){
  const [selected,setSelected]=useState(null),[comparison,setComparison]=useState(null),[loading,setLoading]=useState(false),[tab,setTab]=useState('content');
  const [largeSelection,setLargeSelection]=useState(null),[compareRetry,setCompareRetry]=useState(0);
  const compareController=useRef(null);
  const selectedRepository=repositories.find(repo=>repo.id===selected?.repositoryId);
  const selectedStatus=selected?statuses[selected.repositoryId]:null;
  const selectionKey=JSON.stringify([sessionId,discovery?.cwd,selected?.repositoryId,mode,selected?.id]);
  const large=largeSelection?.key===selectionKey&&largeSelection?.status===selectedStatus;
  useEffect(()=>setLargeSelection(null),[selectionKey,selectedStatus,reviewActive]);
  useEffect(()=>{
    const controller=new AbortController();compareController.current=controller;setComparison(null);setDetailError('');setStats({added:0,deleted:0,count:0});setTab('content');setLoading(!!selected&&!!selectedStatus);
    if(!reviewActive&&selected&&selectedStatus&&selectedRepository)rpc('vcs/compare',{sessionId,repositoryId:selected.repositoryId,mode:requestMode(selectedRepository,mode),id:selected.id,...(large?{large:true}:{})},controller.signal).then(value=>{if(!controller.signal.aborted)setComparison(value);}).catch(e=>{if(controller.signal.aborted)return;if(e.code==='vcs/rediscover-required'){rediscover();return;}setDetailError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[selected,selectedStatus,sessionId,mode,reviewActive,large,compareRetry]);
  const reset=()=>{compareController.current?.abort();setComparison(null);setSelected(null);setDetailError('');setTab('content');setStats({added:0,deleted:0,count:0});};
  const clearSelection=()=>{compareController.current?.abort();setComparison(null);setSelected(null);setDetailError('');};
  const selectFile=(repositoryId,id)=>{compareController.current?.abort();setComparison(null);setTab('content');setSelected({repositoryId,id});};
  const toggleLarge=()=>{compareController.current?.abort();setComparison(null);setLargeSelection(large?null:{key:selectionKey,status:selectedStatus});};
  const retryCompare=()=>setCompareRetry(x=>x+1);
  return {selected,comparison,loading,tab,setTab,large,selectionKey,selectedRepository,selectedStatus,reset,clearSelection,selectFile,toggleLarge,retryCompare};
}

// Diff editor lifecycle and its rendering preferences.
function useEditorLifecycle({editorNode,viewer,setStats,comparison,sessionId,discovery,selected,mode,reviewActive}){
  const [editorRetry,setEditorRetry]=useState(0),[editorReady,setEditorReady]=useState(false),[editorError,setEditorError]=useState(''),[computation,setComputation]=useState('pending');
  const [sideBySide,setSide]=useState(true),[ignoreWhitespace,setWhitespace]=useState(false),[wrap,setWrap]=useState(false);
  useEffect(()=>{
    let disposed=false;let instance;const controller=new AbortController();setEditorReady(false);setEditorError('');
    const link=document.createElement('link');link.rel='stylesheet';link.href=asset('editor.css');document.head.appendChild(link);
    loadEditor(asset('editor.js')+'?v='+encodeURIComponent(version)+'&retry='+editorRetry,{signal:controller.signal}).then(module=>{if(disposed)return;instance=module.createDiff(editorNode.current,{onStats:setStats,onComputation:state=>{if(!disposed)setComputation(state);}});viewer.current=instance;setEditorReady(true);}).catch(e=>{if(!disposed)setEditorError(e.message);});
    return()=>{disposed=true;controller.abort();instance?.dispose();viewer.current=null;link.remove();};
  },[editorRetry]);
  useEffect(()=>{if(editorReady&&(!comparison||comparison.binary||reviewActive))viewer.current?.setContent({left:{text:''},right:{text:''}},'empty');if(editorReady&&comparison&&!comparison.binary&&!reviewActive)viewer.current?.setContent(comparison,JSON.stringify([sessionId,discovery?.cwd,selected?.repositoryId,mode,selected?.id,comparison.path]));},[editorReady,comparison,sessionId,discovery,selected,mode,reviewActive]);
  useEffect(()=>{viewer.current?.options({sideBySide,ignoreWhitespace,wrap});},[editorReady,sideBySide,ignoreWhitespace,wrap]);
  return {setEditorRetry,editorReady,editorError,computation,sideBySide,setSide,ignoreWhitespace,setWhitespace,wrap,setWrap};
}

// File list search, status filters and tree expansion state.
function useFileListState(){
  const [query,setQuery]=useState(''),[statusFilter,setStatusFilter]=useState('all'),[tree,setTree]=useState(true),[collapsedDirectories,setCollapsedDirectories]=useState({});
  const clearFilters=()=>{setQuery('');setStatusFilter('all');};
  return {query,setQuery,statusFilter,setStatusFilter,tree,setTree,collapsedDirectories,setCollapsedDirectories,clearFilters};
}

// Keyboard review shortcuts plus reveal/scroll behaviour for the file list.
function usePanelShortcuts({panelNode,searchNode,fileListNode,revealChange,query,setQuery,changes,selected,reviewActive,repositoryId,selectFile,tree,statusFilter,collapsedDirectories,groups,setTree,clearFilters,chosen,setCollapsedDirectories}){
  const selectAdjacent=direction=>{const next=adjacentChange(changes,selected?.id,direction);if(next)selectFile(repositoryId,next.id);};
  useEffect(()=>{const keydown=e=>{if(reviewActive)return;const action=reviewShortcut(e,panelNode.current,searchNode.current,!!query);if(!action)return;e.preventDefault();if(action==='search'){searchNode.current?.focus();searchNode.current?.select();}else if(action==='clear')setQuery('');else selectAdjacent(action);};window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown);},[query,changes,selected,reviewActive]);
  useEffect(()=>{const key=revealChange.current;if(!key)return;const item=[...(fileListNode.current?.querySelectorAll('button[data-vcs-change]')||[])].find(node=>node.dataset.vcsChange===key);if(item){item.scrollIntoView({block:'nearest'});item.focus();revealChange.current=null;}},[tree,query,statusFilter,collapsedDirectories,groups]);
  const revealSelected=()=>{const entry=chosen;if(!entry||!selected)return;setTree(true);clearFilters();setCollapsedDirectories(old=>{const next={...old};for(const directory of directoryAncestors(entry.path))next[selected.repositoryId+'\0'+directory]=false;return next;});revealChange.current=changeKey(selected.repositoryId,entry.id);};
  return {selectAdjacent,revealSelected};
}

// --- Components -------------------------------------------------------------

// Top bar: project selection, review mode, manual refresh, session path and discovery form.
function PanelHeader({t,repositories,repositoryId,gitSelected,scanning,mode,reviewActive,busy,sessionId,discovery,sessionCwd,subdirectory,onSubdirectoryChange,onRescan,onRepositoryChange,onModeChange,onRefresh,onBack}){
  return <header className="vcs-top"><Icon/><h1 className="vcs-title">{t('title')}</h1><span className="vcs-badge">{t('readonly')}</span><span className="vcs-spacer"/>
    <select aria-label={t('repositories')} value={repositoryId} disabled={scanning||!repositories.length} onChange={e=>onRepositoryChange(e.target.value)}>{!repositories.length&&<option value="">{t('repositories')}</option>}{repositories.map(repo=><option key={repo.id} value={repo.id}>{repositoryLabel(repo,t('workspaceRoot'))}</option>)}</select>
    <label className="vcs-mode">{t('gitMode')} <select aria-label={t('gitMode')} value={mode} disabled={reviewActive||!gitSelected} onChange={e=>onModeChange(e.target.value)}>{['all','unstaged','staged'].map(m=><option key={m} value={m}>{t(m)}</option>)}</select></label>
    <button onClick={onRefresh} disabled={busy||!sessionId}>{t('refresh')}</button><button onClick={onBack}>{t('back')}</button>
    <div className="vcs-path" title={discovery?.cwd||sessionCwd}>{t('session')}: {discovery?.cwd||sessionCwd||'—'}</div>
    <form className="vcs-discovery" onSubmit={e=>{e.preventDefault();onRescan();}}><input aria-label={t('subdirectory')} placeholder={t('subdirectory')} value={subdirectory} onChange={e=>onSubdirectoryChange(e.target.value)}/><button disabled={!sessionId||scanning}>{t('rescan')}</button><span>{t('scanHint')}</span></form>
    {discovery?.truncated&&<div className="vcs-notice">{t('truncated')}</div>}{(discovery?.warnings||[]).map((warning,index)=><div className="vcs-notice" key={index}>{typeof warning==='string'?warning:warning.message||JSON.stringify(warning)}</div>)}
  </header>;
}

// Repository toolbar: one mutually exclusive review view plus the workspace return action.
function RepositoryToolbar({t,gitSelected,historyActive,stashActive,grepActive,reviewActive,setReviewView,openReviewView}){
  return <nav className="vcs-review-views" aria-label={t('reviewView')}><button aria-pressed={!reviewActive} onClick={()=>setReviewView('workspace')}>{t('workspaceView')}</button><button aria-pressed={historyActive} aria-expanded={historyActive} onClick={()=>openReviewView('history')}>{t('history')}</button>{gitSelected&&<><button aria-pressed={stashActive} aria-expanded={stashActive} onClick={()=>openReviewView('stash')}>{t('stash')}</button><button aria-pressed={grepActive} aria-expanded={grepActive} onClick={()=>openReviewView('grep')}>{t('grep')}</button></>}</nav>;
}

// Review view bodies; each panel keys its own request scope so it remounts on scope changes.
function ReviewPanels({sessionId,repositoryId,historyRefresh,scan,rpc,t,rediscover,historyActive,stashActive,grepActive,svnSelected,gitSelected}){
  return <>
    {historyActive&&svnSelected&&<SvnRemote key={JSON.stringify([sessionId,repositoryId,historyRefresh,scan])} {...{sessionId,rpc,t}} onRediscover={rediscover}/>}
    {historyActive&&gitSelected&&<HistoryPanel key={JSON.stringify([sessionId,repositoryId,historyRefresh,scan])} sessionId={sessionId} repositoryId={repositoryId} rpc={rpc} t={t} onRediscover={rediscover}/>}
    {stashActive&&<StashPanel sessionId={sessionId} repositoryId={repositoryId} rpc={rpc} t={t} onRediscover={rediscover}/>}
    {grepActive&&<SearchPanel sessionId={sessionId} repositoryId={repositoryId} rpc={rpc} t={t} onRediscover={rediscover}/>}
  </>;
}

// Localized status filter buttons with current category counts.
function StatusFilterBar({t,statusFilter,statusCounts,onStatusFilter}){
  return <div className="vcs-status-filter" aria-label={t('filterStatus')}>{['all','modified','added','deleted','renamed','conflicted','untracked'].map(value=><button key={value} aria-pressed={statusFilter===value} onClick={()=>onStatusFilter(value)}>{value==='all'?t('allFiles'):t(statusCodes[value]||'M')} <small>{statusCounts[value]||0}</small></button>)}</div>;
}

// One selectable change row.
function FileRow({entry,compact=false,depth=0,repositoryId,selected,t,onSelect}){
  const slash=entry.path.lastIndexOf('/');
  return <button className="vcs-file" data-vcs-item data-vcs-change={changeKey(repositoryId,entry.id)} aria-current={selected?.repositoryId===repositoryId&&selected?.id===entry.id?'true':undefined} style={{paddingInlineStart:8+depth*14}} title={(entry.oldPath?entry.oldPath+' → ':'')+entry.path+' · '+t(changeCode(entry))} onClick={()=>onSelect(repositoryId,entry.id)}><span className="vcs-status" data-status={changeCode(entry)}>{changeCode(entry)}</span><SubmoduleBadge submodule={entry.submodule} t={t}/><span className="vcs-filename">{compact?entry.path.slice(slash+1):entry.path}{entry.oldPath&&<small className="vcs-filepath">← {entry.oldPath}</small>}</span></button>;
}

// Recursive tree rows: directories toggle expansion, files select a comparison.
function TreeRows({node,repository,selected,t,collapsedDirectories,onToggleDirectory,onSelect,depth=0}){
  return <>{node.directories.map(directory=>{const key=repository.id+'\0'+directory.id,closed=!!collapsedDirectories[key];return <React.Fragment key={key}><button className="vcs-dir vcs-dir-toggle" data-vcs-item data-vcs-directory={closed?'closed':'open'} aria-expanded={!closed} style={{paddingInlineStart:8+depth*14}} onClick={()=>onToggleDirectory(key,closed)}><span aria-hidden="true">{closed?'›':'⌄'}</span>{directory.name}<small>{directory.count}</small></button>{!closed&&<TreeRows node={directory} repository={repository} selected={selected} t={t} collapsedDirectories={collapsedDirectories} onToggleDirectory={onToggleDirectory} onSelect={onSelect} depth={depth+1}/>}</React.Fragment>;})}{node.files.map(entry=><FileRow key={changeKey(repository.id,entry.id)} entry={entry} compact={node.id!==''} depth={depth} repositoryId={repository.id} selected={selected} t={t} onSelect={onSelect}/>)}</>;
}

// Focusable file list with keyboard arrow navigation.
function FileList({t,sessionId,scanning,error,groups,statuses,query,tree,collapsedDirectories,selected,mode,fileListNode,onSelect,onToggleDirectory,onRescan}){
  const onFileListKeyDown=e=>handleFileListKeyDown(e,fileListNode.current);
  return <nav className="vcs-filelist" aria-label={t('title')} ref={fileListNode} onKeyDown={onFileListKeyDown}>
    {groups.map(group=>{const repo=group.repository;return <section className="vcs-repository" key={repo.id} aria-label={repositoryLabel(repo,t('workspaceRoot'))}><div className="vcs-repository-heading" title={repo.root}><strong>{repositoryLabel(repo,t('workspaceRoot'))}</strong><small>{repo.type==='svn'?t('svnBase'):t(requestMode(repo,mode))}</small></div>
      {group.error?<div className="vcs-message vcs-error" role="status">{group.error}<button onClick={onRescan}>{t('rescan')}</button></div>:!statuses[repo.id]?<div className="vcs-message">{t('loading')}</div>:tree?<TreeRows node={buildChangeTree(group.changes)} repository={repo} selected={selected} t={t} collapsedDirectories={collapsedDirectories} onToggleDirectory={onToggleDirectory} onSelect={onSelect}/>:group.changes.map(entry=><FileRow key={changeKey(repo.id,entry.id)} entry={entry} repositoryId={repo.id} selected={selected} t={t} onSelect={onSelect}/>)}
      {!group.error&&statuses[repo.id]&&!group.changes.length&&<div className="vcs-message">{query?t('emptySearch'):t('clean')}</div>}
    </section>;})}{!groups.length&&<div className="vcs-message">{scanning?t('loading'):error||(!sessionId?t('noSession'):t('noRepo'))}{error&&<button onClick={onRescan}>{t('rescan')}</button>}</div>}
  </nav>;
}

// File list sidebar: search, filters, tree actions and the list itself.
function FileBrowser({t,sessionId,scanning,error,groups,statuses,query,statusFilter,statusCounts,changes,tree,collapsedDirectories,selected,mode,searchNode,fileListNode,chosen,onQuery,onStatusFilter,onClearFilters,onToggleTree,onExpandAll,onCollapseAll,onRevealSelected,onSelect,onToggleDirectory,onRescan}){
  return <aside className="vcs-files">
    <div className="vcs-filter"><input ref={searchNode} aria-label={t('search')} placeholder={t('search')} title={t('searchShortcut')} value={query} onChange={e=>onQuery(e.target.value)}/>{(query||statusFilter!=='all')&&<button className="vcs-clear-filter" onClick={onClearFilters}>{t('clearFilters')}</button>}</div>
    <StatusFilterBar t={t} statusFilter={statusFilter} statusCounts={statusCounts} onStatusFilter={onStatusFilter}/>
    <div className="vcs-count"><span>{changes.length} {t('files')}</span><span className="vcs-auto">{t('autoRefresh')}</span><button aria-pressed={tree} onClick={onToggleTree}>{t(tree?'tree':'list')}</button></div>
    {tree&&<div className="vcs-tree-actions"><button onClick={onExpandAll}>{t('expandAll')}</button><button onClick={onCollapseAll}>{t('collapseAll')}</button><button onClick={onRevealSelected} disabled={!chosen}>{t('revealSelected')}</button></div>}
    <FileList t={t} sessionId={sessionId} scanning={scanning} error={error} groups={groups} statuses={statuses} query={query} tree={tree} collapsedDirectories={collapsedDirectories} selected={selected} mode={mode} fileListNode={fileListNode} onSelect={onSelect} onToggleDirectory={onToggleDirectory} onRescan={onRescan}/>
  </aside>;
}

// File head with the safe copy-path control and the diff statistics.
function DetailHeader({t,comparison,chosen,selectedRepository,editorReady,stats,onCopyError}){
  const [copiedPath,setCopiedPath]=useState(false);
  const copyPath=async()=>{const value=comparison?.path||chosen?.path;if(!value)return;try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);else {const input=document.createElement('textarea');try{input.value=value;input.style.cssText='position:fixed;opacity:0';document.body.appendChild(input);input.select();if(!document.execCommand('copy'))throw Error('copy failed');}finally{input.remove();}}setCopiedPath(true);window.setTimeout(()=>setCopiedPath(false),1500);}catch{onCopyError(t('copyFailed'));}};
  return <div className="vcs-filehead"><strong title={comparison?.path||chosen?.path}>{selectedRepository?repositoryLabel(selectedRepository,t('workspaceRoot'))+' / ':''}{comparison?.path||chosen?.path||t('pick')}</strong><button className="vcs-copy-path" disabled={!(comparison?.path||chosen?.path)} onClick={copyPath}>{t(copiedPath?'copied':'copyPath')}</button>{copiedPath&&<span className="vcs-sr-only" role="status">{t('pathCopied')}</span>}<span className="vcs-spacer"/>{comparison&&!comparison.binary&&editorReady&&<><span className="vcs-add">+{stats.added}</span><span className="vcs-del">−{stats.deleted}</span></>}</div>;
}

// Comparison context: status, rename and the two compared labels with encodings.
function ComparisonContext({t,comparison}){
  return comparison?<div className="vcs-context" aria-label={t('comparisonContext')}><span className="vcs-context-status" data-status={changeCode(comparison)}>{t(changeCode(comparison))}</span>{comparison.oldPath&&<span className="vcs-context-rename" title={comparison.oldPath+' → '+comparison.path}>{comparison.oldPath} <b>→</b> {comparison.path}</span>}<span>{comparison.left.label||'—'} <b>↔</b> {comparison.right.label||'—'}</span>{(comparison.left.encoding||comparison.right.encoding)&&<span>{t('encoding')}: {comparison.left.encoding||'—'} / {comparison.right.encoding||'—'}</span>}</div>:null;
}

// Optional comparison panels: image preview, large-file scope, notices, submodule scope and conflicts.
function ComparisonExtras({t,comparison,selected,selectedRepository,selectedStatus,sessionId,mode,discoveryCwd,refresh,rpc,rediscover,large,selectionKey,detailError,editorError,computation,onToggleLarge,onRetryCompare}){
  return <>
    {comparison&&selectedRepository?.type==='git'&&<ImageComparison key={JSON.stringify([sessionId,discoveryCwd,selected.repositoryId,mode,selected.id,refresh,selectedStatus])} workspace sessionId={sessionId} repositoryId={selected.repositoryId} mode={mode} id={selected.id} rpc={rpc} t={t} onRediscover={rediscover}/>}
    {selectedRepository?.type==='git'&&(large||comparison?.notice?.includes('2 MiB'))&&<div className="vcs-notice"><span>{t('workspaceLargeScope')}</span><button onClick={onToggleLarge}>{t(large?'largeClose':'largeLoad')}</button>{large&&detailError&&<button onClick={onRetryCompare}>{t('retry')}</button>}</div>}
    {comparison?.large&&<p role="status">{t(editorError?'largeFallback':computation==='complete'?'diffComplete':computation==='incomplete'?'diffIncomplete':'diffPending')}</p>}
    {comparison?.notice&&<div className="vcs-notice">{comparison.notice}</div>}
    {comparison?.submodule&&<p role="status">{t('submoduleScope')}</p>}
    {comparison?.status==='conflicted'&&selectedRepository?.type==='git'&&<ConflictStages key={JSON.stringify([sessionId,selected.repositoryId,mode,selected.id,refresh])} sessionId={sessionId} repositoryId={selected.repositoryId} mode={mode} id={selected.id} rpc={rpc} t={t} onRediscover={rediscover}/>}
  </>;
}

// Diff surface with the text fallback and the empty/loading/error overlay.
function EditorBox({t,comparison,editorNode,editorError,overlay,tab,error,detailError,onRetryEditor,onRescan}){
  return <div className="vcs-editorbox" data-hidden={!!overlay||tab!=='content'} style={tab==='properties'?{display:'none'}:undefined}><div className="vcs-editor" ref={editorNode} style={editorError?{display:'none'}:undefined}/>{editorError&&comparison&&!comparison.binary&&!overlay&&<TextComparison comparison={comparison} labels={comparisonLabels(t)}/>}{overlay&&<div className={'vcs-message '+((error||detailError||editorError)?'vcs-error':'')} role="status">{overlay}{(error||detailError||editorError)&&<button onClick={()=>editorError?onRetryEditor():onRescan()}>{t(editorError?'retry':'rescan')}</button>}</div>}</div>;
}

// SVN property comparison table.
function PropertyTable({t,comparison,properties,propertyNames}){
  return <div className="vcs-properties"><table><thead><tr><th>{t('properties')}</th><th>{comparison?.left.label||t('before')}</th><th>{comparison?.right.label||t('after')}</th></tr></thead><tbody>{propertyNames.map(name=><tr key={name}><th>{name}</th><td>{properties.left?.[name]??'—'}</td><td>{properties.right?.[name]??'—'}</td></tr>)}</tbody></table></div>;
}

// Bottom toolbar: editor options, diff navigation and visible change position.
function DetailToolbar({t,editorReady,sideBySide,setSide,ignoreWhitespace,setWhitespace,wrap,setWrap,stats,overlay,comparison,viewer,changes,selected,onSelectAdjacent}){
  const reviewPosition=changePosition(changes,selected?.id);
  return <footer className="vcs-toolbar"><button disabled={!editorReady} aria-pressed={sideBySide} onClick={()=>setSide(!sideBySide)}>{t(sideBySide?'side':'inline')}</button><label><input type="checkbox" disabled={!editorReady} checked={ignoreWhitespace} onChange={e=>setWhitespace(e.target.checked)}/>{t('whitespace')}</label><label><input type="checkbox" disabled={!editorReady} checked={wrap} onChange={e=>setWrap(e.target.checked)}/>{t('wrap')}</label><span className="vcs-spacer"/>{editorReady&&<span>{stats.count} {t('changes')}</span>}<button disabled={!editorReady||!comparison||!!overlay} onClick={()=>viewer.current?.navigate('previous')}>{t('previous')}</button><button disabled={!editorReady||!comparison||!!overlay} onClick={()=>viewer.current?.navigate('next')}>{t('next')}</button>{reviewPosition.index>0&&<span className="vcs-review-position">{t('reviewPosition',{index:reviewPosition.index,total:reviewPosition.total})}</span>}<span className="vcs-toolbar-separator"/><button title={t('fileShortcut')} disabled={!changes.length} onClick={()=>onSelectAdjacent('previous')}>{t('previousFile')}</button><button title={t('fileShortcut')} disabled={!changes.length} onClick={()=>onSelectAdjacent('next')}>{t('nextFile')}</button></footer>;
}

// Detail pane: file head, comparison context/panels, tabs, diff surface, properties and toolbar.
function DetailPane({t,comparison,selected,selectedRepository,selectedStatus,sessionId,mode,discoveryCwd,refresh,rpc,rediscover,large,selectionKey,loading,detailError,error,busy,chosen,repositoryCount,editorNode,editorReady,editorError,computation,tab,setTab,stats,onRetryEditor,onRetryCompare,onRescan,onToggleLarge,sideBySide,setSide,ignoreWhitespace,setWhitespace,wrap,setWrap,viewer,changes,onSelectAdjacent,onCopyError}){
  const properties=comparison?.properties;
  const propertyNames=properties?[...new Set([...Object.keys(properties.left||{}),...Object.keys(properties.right||{})])].filter(k=>properties.left?.[k]!==properties.right?.[k]):[];
  const binarySummary=comparison?.binary?[comparison.left.label,comparison.right.label].filter(Boolean).join(' ↔ '):'';
  const overlay=detailError||(loading?t('loading'):!sessionId?t('noSession'):busy&&!chosen?t('loading'):error?error:!repositoryCount?t('noRepo'):!chosen?t('pick'):comparison?.binary?t('binary')+(binarySummary?' '+t('binaryComparison',{files:binarySummary}):''):!comparison?t('pick'):!editorReady&&!editorError?t('loading'):'');
  return <main className="vcs-detail"><DetailHeader t={t} comparison={comparison} chosen={chosen} selectedRepository={selectedRepository} editorReady={editorReady} stats={stats} onCopyError={onCopyError}/>
    {editorError&&<div className="vcs-notice" role="status">{t('fallback')} <button onClick={onRetryEditor}>{t('retry')}</button><details><summary>{t('diagnostics')}</summary>{editorError}</details></div>}
    <ComparisonContext t={t} comparison={comparison}/>
    <ComparisonExtras t={t} comparison={comparison} selected={selected} selectedRepository={selectedRepository} selectedStatus={selectedStatus} sessionId={sessionId} mode={mode} discoveryCwd={discoveryCwd} refresh={refresh} rpc={rpc} rediscover={rediscover} large={large} selectionKey={selectionKey} detailError={detailError} editorError={editorError} computation={computation} onToggleLarge={onToggleLarge} onRetryCompare={onRetryCompare}/>
    {propertyNames.length>0&&<div className="vcs-tabs">{['content','properties'].map(value=><button key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{t(value)}{value==='properties'?' ('+propertyNames.length+')':''}</button>)}</div>}
    <div className="vcs-labels"><span>{comparison?.left.label||'—'}{comparison?.left.encoding?' · '+comparison.left.encoding:''}</span><span>{comparison?.right.label||'—'}{comparison?.right.encoding?' · '+comparison.right.encoding:''}</span></div>
    <EditorBox t={t} comparison={comparison} editorNode={editorNode} editorError={editorError} overlay={overlay} tab={tab} error={error} detailError={detailError} onRetryEditor={onRetryEditor} onRescan={onRescan}/>
    {tab==='properties'&&<PropertyTable t={t} comparison={comparison} properties={properties} propertyNames={propertyNames}/>}
    <DetailToolbar t={t} editorReady={editorReady} sideBySide={sideBySide} setSide={setSide} ignoreWhitespace={ignoreWhitespace} setWhitespace={setWhitespace} wrap={wrap} setWrap={setWrap} stats={stats} overlay={overlay} comparison={comparison} viewer={viewer} changes={changes} selected={selected} onSelectAdjacent={onSelectAdjacent}/>
  </main>;
}

export function createPage(ctx,{initialView='workspace',onViewChange}={}){
  const t=ctx.locale.bind('local.vcs');
  const scheduleStatus=createStatusLimiter(2);
  const rpc=createClientRpc(ctx.connection,()=>t('error'));
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
    const panelNode=useRef(null),editorNode=useRef(null),viewer=useRef(null),fileListNode=useRef(null),searchNode=useRef(null),revealChange=useRef(null),invalidateRef=useRef(null);
    const [reviewView,setReviewView]=useReviewView(initialView,onViewChange);
    const {mode,setMode,statuses,setStatuses,detailError,setDetailError,stats,setStats}=useWorkspaceSharedState();
    // Loaders are created before the shared reset exists; this late-bound handler keeps the
    // single invalidation path (and its state-reset order) without reordering hooks.
    const invalidateLatest=()=>invalidateRef.current?.();
    const {discovery,repositories,repositoryId,setRepositoryId,scan,subdirectory,setSubdirectory,scanning,error,rescan,rediscover}=useRepositoryDiscovery({session,rpc,invalidate:invalidateLatest,setStatuses});
    const visibleRepositories=repositories.filter(repo=>repo.id===repositoryId);
    const gitSelected=visibleRepositories.some(repo=>repo.type==='git');
    const svnSelected=visibleRepositories.some(repo=>repo.type==='svn');
    const historyActive=(gitSelected||svnSelected)&&reviewView==='history';
    const stashActive=gitSelected&&reviewView==='stash';
    const grepActive=gitSelected&&reviewView==='grep';
    const reviewActive=historyActive||stashActive||grepActive;
    const {refresh,historyRefresh,refreshStatuses,abortStatus}=useStatusLoading({sessionId,rpc,scheduleStatus,discovery,repositoryId,mode,visibleRepositories,setStatuses,setDetailError,rediscover,invalidate:invalidateLatest});
    const {selected,comparison,loading,tab,setTab,large,selectionKey,selectedRepository,selectedStatus,reset:resetComparison,clearSelection,selectFile,toggleLarge,retryCompare}=useComparisonLoader({sessionId,rpc,discovery,repositories,statuses,mode,reviewActive,setDetailError,setStats,rediscover});
    const invalidate=()=>{abortStatus();resetComparison();};
    invalidateRef.current=invalidate; // Only read from handlers and settled promises, so the latest reset is used.
    const openReviewView=view=>{clearSelection();setReviewView(view);};
    const {setEditorRetry,editorReady,editorError,computation,sideBySide,setSide,ignoreWhitespace,setWhitespace,wrap,setWrap}=useEditorLifecycle({editorNode,viewer,setStats,comparison,sessionId,discovery,selected,mode,reviewActive});
    const {query,setQuery,statusFilter,setStatusFilter,tree,setTree,collapsedDirectories,setCollapsedDirectories,clearFilters}=useFileListState();
    const groups=groupChanges(visibleRepositories,statuses,query,statusFilter);
    const changes=groups.flatMap(group=>group.changes);
    const statusCounts=countChangeStatuses(selectedStatus?.changes);
    const chosen=selectedStatus?.changes?.find(c=>c.id===selected?.id);
    const setTreeExpanded=expanded=>setCollapsedDirectories(old=>{const next={...old};for(const group of groups)for(const id of treeDirectoryIds(buildChangeTree(group.changes)))next[group.repository.id+'\0'+id]=!expanded;return next;});
    const busy=scanning||visibleRepositories.some(repo=>!statuses[repo.id]);
    const {selectAdjacent,revealSelected}=usePanelShortcuts({panelNode,searchNode,fileListNode,revealChange,query,setQuery,changes,selected,reviewActive,repositoryId,selectFile,tree,statusFilter,collapsedDirectories,groups,setTree,clearFilters,chosen,setCollapsedDirectories});
    return <section ref={panelNode} className="vcs-root" aria-label={t('title')}><style>{css}</style>
      <PanelHeader t={t} repositories={repositories} repositoryId={repositoryId} gitSelected={gitSelected} scanning={scanning} mode={mode} reviewActive={reviewActive} busy={busy} sessionId={sessionId} discovery={discovery} sessionCwd={session?.cwd} subdirectory={subdirectory} onSubdirectoryChange={setSubdirectory} onRescan={rescan} onRepositoryChange={value=>{invalidate();setStatuses({});setRepositoryId(value);}} onModeChange={value=>{invalidate();setStatuses({});setMode(value);}} onRefresh={()=>refreshStatuses(false)} onBack={()=>ctx.layout.selectPanel(null)}/>
      {visibleRepositories.filter(repo=>repo.type==='svn'&&!reviewActive).map(repo=><React.Fragment key={JSON.stringify([sessionId,repo.id,scan,refresh])}><SvnIdentity repositoryId={repo.id} {...{sessionId,rpc,t}} onRediscover={rediscover}/></React.Fragment>)}
      {(gitSelected||svnSelected)&&<><RepositoryToolbar t={t} gitSelected={gitSelected} historyActive={historyActive} stashActive={stashActive} grepActive={grepActive} reviewActive={reviewActive} setReviewView={setReviewView} openReviewView={openReviewView}/><ReviewPanels sessionId={sessionId} repositoryId={repositoryId} historyRefresh={historyRefresh} scan={scan} rpc={rpc} t={t} rediscover={rediscover} historyActive={historyActive} stashActive={stashActive} grepActive={grepActive} svnSelected={svnSelected} gitSelected={gitSelected}/></>}
      <div className="vcs-body" hidden={reviewActive} aria-label={t('workspaceView')}><FileBrowser t={t} sessionId={sessionId} scanning={scanning} error={error} groups={groups} statuses={statuses} query={query} statusFilter={statusFilter} statusCounts={statusCounts} changes={changes} tree={tree} collapsedDirectories={collapsedDirectories} selected={selected} mode={mode} searchNode={searchNode} fileListNode={fileListNode} chosen={chosen} onQuery={setQuery} onStatusFilter={setStatusFilter} onClearFilters={clearFilters} onToggleTree={()=>setTree(!tree)} onExpandAll={()=>setTreeExpanded(true)} onCollapseAll={()=>setTreeExpanded(false)} onRevealSelected={revealSelected} onSelect={selectFile} onToggleDirectory={(key,closed)=>setCollapsedDirectories(old=>({...old,[key]:!closed}))} onRescan={rescan}/><DetailPane t={t} comparison={comparison} selected={selected} selectedRepository={selectedRepository} selectedStatus={selectedStatus} sessionId={sessionId} mode={mode} discoveryCwd={discovery?.cwd} refresh={refresh} rpc={rpc} rediscover={rediscover} large={large} selectionKey={selectionKey} loading={loading} detailError={detailError} error={error} busy={busy} chosen={chosen} repositoryCount={repositories.length} editorNode={editorNode} editorReady={editorReady} editorError={editorError} computation={computation} tab={tab} setTab={setTab} stats={stats} onRetryEditor={()=>setEditorRetry(x=>x+1)} onRetryCompare={retryCompare} onRescan={rescan} onToggleLarge={toggleLarge} sideBySide={sideBySide} setSide={setSide} ignoreWhitespace={ignoreWhitespace} setWhitespace={setWhitespace} wrap={wrap} setWrap={setWrap} viewer={viewer} changes={changes} onSelectAdjacent={selectAdjacent} onCopyError={setDetailError}/></div>
    </section>;
  }
  return Page;
}
export function apply(ctx){
  ctx.effect(()=>ctx.locale.register('local.vcs',dictionaries));
  const t=ctx.locale.bind('local.vcs');
  const Page=createPage(ctx);
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'local-vcs'},Page));
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'local-vcs',label:()=>t('title'),order:65},Icon));
}
