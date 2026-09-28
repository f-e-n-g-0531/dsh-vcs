import React, {useMemo} from 'react';
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
export default function TextComparison({comparison, labels = {}}) {
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
