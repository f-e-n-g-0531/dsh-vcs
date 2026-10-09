/** Handle only visible list items; focus movement never selects a file. */
export function handleFileListKeyDown(event, node) {
  const items = node ? [...node.querySelectorAll('button[data-vcs-item]')] : [];
  const index = items.indexOf(event.target);
  if (index < 0) return;
  let next;
  if (event.key === 'ArrowDown') next = items[index + 1];
  else if (event.key === 'ArrowUp') next = items[index - 1];
  else if (event.key === 'Home') next = items[0];
  else if (event.key === 'End') next = items.at(-1);
  else if ((event.key === 'ArrowRight' && event.target.dataset.vcsDirectory === 'closed') ||
           (event.key === 'ArrowLeft' && event.target.dataset.vcsDirectory === 'open')) {
    event.preventDefault();
    event.target.click();
    return;
  } else return;
  event.preventDefault();
  next?.focus();
}
