import React,{useState} from 'react';
import GrepPanel from './GrepPanel.jsx';
import HistoryPanel from './HistoryPanel.jsx';

// Mode changes unmount the previous owner: no hidden queries or stale responses.
export default function SearchPanel(props){
 return <ScopedSearchPanel key={JSON.stringify([props.sessionId,props.repositoryId])} {...props}/>;
}
function ScopedSearchPanel({t,...props}){
 const [mode,setMode]=useState('content');
 return <section className="vcs-search-panel" aria-label={t('searchCenter')}>
  <nav className="vcs-search-modes" aria-label={t('searchMode')}>
   <button aria-pressed={mode==='content'} onClick={()=>setMode('content')}>{t('searchContentMode')}</button>
   <button aria-pressed={mode==='history'} onClick={()=>setMode('history')}>{t('searchHistoryMode')}</button>
  </nav>
  {mode==='content'?<GrepPanel {...props} t={t}/>:<HistoryPanel {...props} t={t} showSearch/>}
 </section>;
}
