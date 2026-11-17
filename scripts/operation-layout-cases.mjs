// Shared by the focused browser runner and its small contract test.
export const operationLayoutCases = Object.freeze(
  ['zh', 'en'].flatMap(language => [1100, 600, 320].flatMap(width =>
    [720, 480].flatMap(height => ['empty', 'modified', 'status-error'].map(status =>
      Object.freeze({language, width, height, status}))))));
export const operationLayoutStates = Object.freeze(['short-reference', 'long-reference', 'scan-warning']);
