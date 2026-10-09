import * as fs from 'node:fs/promises';
import path from 'node:path';

/** Lexical containment; real paths are checked separately by confined. */
export function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

/** Validate existing components and the nearest real ancestor of missing paths. */
export async function confined(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw new Error('Invalid repository path');
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('Path escapes repository');
  // Inspect each existing component, including dangling links whose realpath fails.
  let component = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    component = path.join(component, part);
    try {
      if ((await fs.lstat(component)).isSymbolicLink()) {
        const destination = path.resolve(path.dirname(component), await fs.readlink(component));
        if (!inside(root, destination)) throw new Error('Symlink escapes repository');
      }
    } catch (e) { if (!['ENOENT', 'ENOTDIR'].includes(e.code)) throw e; }
  }
  let current = target;
  for (;;) {
    try { const real = await fs.realpath(current); if (!inside(root, real)) throw new Error('Symlink escapes repository'); break; }
    catch (e) { if (!['ENOENT', 'ENOTDIR'].includes(e.code)) throw e; const parent = path.dirname(current); if (parent === current) throw e; current = parent; }
  }
  return target;
}
