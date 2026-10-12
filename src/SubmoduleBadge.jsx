import React from 'react';
// Read-only gitlink badge: recorded pointer, local checkout presence and (for an
// initialized checkout) the parent's own status--porcelain=v2 submodule state.
export default function SubmoduleBadge({submodule,t}){
 if(!submodule||typeof submodule.recorded!=='string')return null;
 const state=submodule.checkout;
 const flags=[];
 if(submodule.pointerMoved)flags.push(t('submodulePointerMoved'));
 if(submodule.dirty||submodule.untracked)flags.push(t('submoduleDirty'));
 const title=[submodule.recorded+' · '+t('submoduleCheckout_'+state),...flags].join(' · ');
 return <span className="vcs-submodule" data-checkout={state} data-pointer-moved={submodule.pointerMoved?'true':undefined} data-untracked={submodule.untracked?'true':undefined} title={title}>{t('submoduleBadge')} {submodule.recorded.slice(0,10)}{flags.length?` · ${flags.join(', ')}`:''}</span>;
}
