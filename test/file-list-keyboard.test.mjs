import test from 'node:test';
import assert from 'node:assert/strict';
import {handleFileListKeyDown} from '../src/file-list-keyboard.mjs';

test('list arrows move focus without selecting and retain edge behavior', () => {
  const focused = [], clicked = [];
  const items = [0, 1, 2].map(id => ({dataset: {}, focus: () => focused.push(id), click: () => clicked.push(id)}));
  const node = {querySelectorAll: () => items};
  let prevented = 0;
  const send = (key, target = items[1]) => handleFileListKeyDown({key, target, preventDefault: () => prevented++}, node);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) send(key);
  assert.deepEqual(focused, [2, 0, 0, 2]);
  send('ArrowDown', items[2]);
  assert.equal(prevented, 5);
  assert.deepEqual(clicked, []);
  send('Enter');
  send('ArrowDown', {});
  assert.equal(prevented, 5);
  items[1].dataset.vcsDirectory = 'closed';
  send('ArrowRight');
  items[1].dataset.vcsDirectory = 'open';
  send('ArrowLeft');
  assert.deepEqual(clicked, [1, 1]);
});
