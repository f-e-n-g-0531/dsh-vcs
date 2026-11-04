import React, {useEffect, useMemo, useRef, useState} from 'react';
import {singleFileWindow, SINGLE_WINDOW_LINES} from './single-file-window.mjs';
import {alignLines, MAX_DISPLAY_LINES} from './text-comparison.mjs';

const defaults = {
  before: 'Before', after: 'After', readonly: 'Read-only text comparison',
  approximate: 'Approximate alignment: the changed region is too large for exact matching; lines are paired by position.',
  truncated: 'Preview truncated to the first 2,000 aligned lines; additional lines are not shown.',
  empty: 'Both versions are empty.',
};
const cellStyle = {verticalAlign: 'top', padding: 0, width: '50%', borderRight: '1px solid var(--border, #8884)'};
const lineStyle = {display: 'flex', minHeight: '1.5em', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5};
const numberStyle = {flex: '0 0 6ch', textAlign: 'right', paddingRight: 8, opacity: 0.65, userSelect: 'none'};
const textStyle = {margin: 0, flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', tabSize: 4, font: 'inherit'};

// Deliberately no HTML insertion or editable controls: source is React text.
export default function TextComparison(props) {
  return props.single ? <SingleFileText {...props}/> : <AlignedText {...props}/>;
}

function SingleFileText({comparison, labels = {}, line = null, startLine = 1, emptyLine = false}) {
  const text = comparison?.right?.text ?? '';
  const [anchor, setAnchor] = useState(null), target = useRef(null), container = useRef(null);
  useEffect(() => setAnchor(null), [text, line, startLine, emptyLine]);
  const result = useMemo(() => singleFileWindow(text, {line, startLine, anchor, emptyLine}), [text, line, startLine, anchor, emptyLine]);
  useEffect(() => {
    if (container.current) container.current.scrollTop = target.current ? Math.max(0, target.current.offsetTop - container.current.clientHeight / 2) : 0;
  }, [result]);
  return <section ref={container} className="vcs-text-comparison vcs-single-file" aria-label={labels.singleReadonly ?? 'Read-only file'} style={{overflow:'auto',position:'absolute',inset:0}} tabIndex={0}>
    <p role="status">{labels.window ?? 'Lines shown'}: {result.startLine}–{result.endLine} / {result.baseLine}–{result.baseLine + Math.max(0,result.totalLines - 1)}</p>
    {line !== null && !result.targetFound && <p role="status">{labels.targetMissing ?? 'Requested line is not in the available text'}</p>}
    {result.truncated && <nav>
      <button disabled={result.startLine <= result.baseLine} onClick={() => setAnchor(Math.max(result.baseLine, result.startLine - SINGLE_WINDOW_LINES / 2))}>{labels.previous ?? 'Previous'}</button>
      <button disabled={result.endLine >= result.baseLine + result.totalLines - 1} onClick={() => setAnchor(result.endLine + SINGLE_WINDOW_LINES / 2 + 1)}>{labels.next ?? 'Next'}</button>
    </nav>}
    <div aria-label={comparison?.right?.label}>
      {result.rows.map(row => <div key={row.number} ref={row.number === line ? target : null} data-line={row.number} data-target={row.number === line || undefined} aria-current={row.number === line ? 'location' : undefined} style={{...lineStyle,background:row.number === line ? 'var(--dsw-alias-code-diff-added, #259b4940)' : undefined,outline:row.number === line ? '1px solid currentColor' : undefined}}>
        <span style={numberStyle}>{row.number}</span><pre style={textStyle}>{row.text}</pre>
      </div>)}
    </div>
    {!result.rows.length && <p>{labels.empty ?? defaults.empty}</p>}
  </section>;
}

function AlignedText({comparison, labels = {}}) {
  const before = comparison?.left?.text ?? '';
  const after = comparison?.right?.text ?? '';
  const result = useMemo(() => alignLines(before, after), [before, after]);
  const label = key => labels[key] ?? defaults[key];
  const renderCell = (cell, side, kind) => {
    const changed = cell && kind !== 'equal';
    return <td style={{...cellStyle, background: changed ? (side === 'left' ? '#d6454520' : '#259b4920') : undefined}}>
      <div style={lineStyle}>
        <span style={numberStyle}>{cell?.number ?? ''}</span>
        <span aria-hidden="true" style={{flex: '0 0 2ch', userSelect: 'none'}}>{changed ? (side === 'left' ? '−' : '+') : ''}</span>
        <pre style={textStyle}>{cell?.text ?? ''}</pre>
      </div>
    </td>;
  };
  return <section className="vcs-text-comparison" aria-label={label('readonly')} style={{flex: '1 1 0', minHeight: 0, minWidth: 0, overflow: 'auto', position: 'absolute', inset: 0}} tabIndex={0}>
    {result.approximate && <div role="status" style={{padding: 8}}>{label('approximate')}</div>}
    {result.truncated && <div role="status" style={{padding: 8}}>{label('truncated')} ({MAX_DISPLAY_LINES} / {result.totalRows})</div>}
    <table style={{width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'left'}}>
      <thead><tr>
        <th scope="col" style={{...cellStyle, padding: 8, overflowWrap: 'anywhere'}}>{comparison?.left?.label || label('before')}</th>
        <th scope="col" style={{...cellStyle, padding: 8, overflowWrap: 'anywhere'}}>{comparison?.right?.label || label('after')}</th>
      </tr></thead>
      <tbody>{result.rows.map((row, index) => <tr key={index} data-kind={row.kind}>
        {renderCell(row.left, 'left', row.kind)}{renderCell(row.right, 'right', row.kind)}
      </tr>)}</tbody>
    </table>
    {!result.rows.length && <p style={{padding: 8}}>{label('empty')}</p>}
  </section>;
}
