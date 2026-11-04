import {useEffect, useRef, useState} from 'react';
import {startHistoryEditor} from './history-editor.mjs';
import {loadEditor} from './editor-loader.mjs';
import {version} from '../package.json';

/** Own one editor instance and stylesheet for the current immutable selection. */
export function useHistoryEditor({comparison, identity, enabled, single, line, startLine = 1, sideBySide, ignoreWhitespace, wrap}) {
  const node = useRef(null);
  const viewer = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [computation, setComputation] = useState('pending');
  const [generation, setGeneration] = useState(0);
  const attempt = useRef(null);
  const failedAttempt = attempt.current;
  const retry = () => {
    // A retained click must not restart a cancelled, replaced, or already retried task.
    if (!enabled || !error || !failedAttempt?.failed || attempt.current !== failedAttempt) return;
    failedAttempt.failed = false;
    setError('');
    setGeneration(value => value + 1);
  };

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
    const current = {failed: false};
    attempt.current = current;
    const task = startHistoryEditor({
      node: node.current, comparison, key: identity, single,
      load: signal => loadEditor(asset('editor.js') + '?v=' + encodeURIComponent(version) + '&retry=' + generation, {signal}),
      onReady: instance => { viewer.current = instance; setReady(true); },
      onError: failure => { current.failed = true; setError(failure.message); },
      onComputation: setComputation,
    });
    return () => {
      attempt.current = null;
      current.failed = false;
      viewer.current = null;
      try { task.dispose(); } finally { link.remove(); }
    };
  }, [enabled, comparison, identity, single, generation]);

  useEffect(() => {
    if (ready && single && line) viewer.current?.revealLine(line);
  }, [ready, single, line]);
  useEffect(() => {
    if (ready) viewer.current?.options({sideBySide, ignoreWhitespace, wrap, startLine});
  }, [ready, sideBySide, ignoreWhitespace, wrap, startLine]);

  return {node, viewer, ready, error, computation, retry};
}
