import {execFileSync} from 'node:child_process';

/** Fixture-only writes stay explicit in each test and scoped to its temporary root. */
export function gitCommand(root) {
  return (...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}
