import {useEffect, useRef, useState} from 'react';
import {startHistoryEditor} from './history-editor.mjs';
import {loadEditor} from './editor-loader.mjs';
import {version} from '../package.json';

/** Own one editor instance and stylesheet for the current immutable selection. */
export function useHistoryEditor({comparison, identity, enabled, single, line, sideBySide, ignoreWhitespace, wrap}) {
  const node = useRef(null);
  const viewer = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [computation, setComputation] = useState('pending');

  useEffect(() => {
    setReady(false);
    setComputation('pending');
    setError('');
    if (!enabled) return;
    const asset = name => new URL('vcs-assets/' + name, document.baseURI).href;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = asset('editor.css');
    document.head.appendChild(link);
    const task = startHistoryEditor({
      node: node.current, comparison, key: identity, single,
      load: signal => loadEditor(asset('editor.js') + '?v=' + encodeURIComponent(version) + '&retry=0', {signal}),
      onReady: instance => { viewer.current = instance; setReady(true); },
      onError: failure => setError(failure.message),
      onComputation: setComputation,
    });
    return () => {
      viewer.current = null;
      try { task.dispose(); } finally { link.remove(); }
    };
  }, [enabled, comparison, identity, single]);

  useEffect(() => {
    if (ready && single && line) viewer.current?.revealLine(line);
  }, [ready, single, line]);
  useEffect(() => {
    if (ready) viewer.current?.options({sideBySide, ignoreWhitespace, wrap});
  }, [ready, sideBySide, ignoreWhitespace, wrap]);

  return {node, viewer, ready, error, computation};
}
