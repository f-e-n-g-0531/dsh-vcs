import {MAX_TEXT,MAX_LARGE_TEXT} from '../text-content.mjs';

/** Machine-readable capability contract. Human notices never decide an action. */
export function comparisonPreview({left = {},right = {},large = false,allowLarge = false,conflicted = false} = {}) {
  const sides = [left,right];
  const reason = sides.some(side => side.binary) ? 'binary'
    : sides.some(side => side.previewReason === 'size-limit') ? 'size-limit'
    : sides.find(side => side.previewReason)?.previewReason ?? null;
  return {
    reason,
    canLoadLarge: !large && allowLarge && !conflicted && reason === 'size-limit' && sides.every(side => side.largeEligible !== false),
    complete: reason === null,
    limits: {previewBytes:MAX_TEXT,largeBytes:MAX_LARGE_TEXT},
  };
}

export function withComparisonPreview(comparison, options = {}) {
  return {...comparison,preview:comparisonPreview({...options,large:comparison.large ?? options.large,left:options.left ?? comparison.left,right:options.right ?? comparison.right})};
}
