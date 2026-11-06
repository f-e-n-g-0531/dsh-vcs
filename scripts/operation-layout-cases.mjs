// Shared by the focused browser runner and its small contract test.
export const operationLayoutCases = Object.freeze(
  ['zh', 'en'].flatMap(language => [1100, 600, 320].flatMap(width =>
    [720, 480].flatMap(height => ['all', 'staged', 'unstaged'].map(mode =>
      Object.freeze({language, width, height, mode}))))));
export const operationLayoutStates = Object.freeze(['closed', 'list', 'preview']);
