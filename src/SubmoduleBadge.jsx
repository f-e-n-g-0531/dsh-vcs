import React from 'react';
// Read-only gitlink badge: recorded pointer plus local checkout presence.
export default function SubmoduleBadge({submodule,t}){
 if(!submodule||typeof submodule.recorded!=='string')return null;
 const state=submodule.checkout;
 return <span className="vcs-submodule" data-checkout={state} title={submodule.recorded+' · '+t('submoduleCheckout_'+state)}>{t('submoduleBadge')} {submodule.recorded.slice(0,10)}</span>;
}
