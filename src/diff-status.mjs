/** Monaco 0.52 view-model observations; fail closed if unavailable. */
export function diffStatus(viewModel) {
  const result = viewModel?.diff?.get?.();
  if (!result || !viewModel?.isDiffUpToDate?.get?.()) return 'pending';
  return result.quitEarly === false ? 'complete' : 'incomplete';
}
