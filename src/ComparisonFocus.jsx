import React from 'react';

export default function ComparisonFocus({t,focused,onToggle}){
 return <button type="button" className="vcs-comparison-focus" aria-pressed={focused} onClick={()=>onToggle(!focused)}>{t(focused?'comparisonRestore':'comparisonFocus')}</button>;
}
