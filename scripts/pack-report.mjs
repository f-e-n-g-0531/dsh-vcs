// Some npm versions forward lifecycle stdout even with --json/--ignore-scripts.
// Accept only a complete trailing JSON report, never eval or truncate JSON.
export function parsePackReport(output) {
  const text=output.trim();
  for (let i=0;i<text.length;i++) {
    if(text[i]!=='[' || (i>0 && text.charCodeAt(i-1)!==10))continue;
    try {
      const report=JSON.parse(text.slice(i));
      if(Array.isArray(report)&&report.length===1&&typeof report[0]?.filename==='string'&&Array.isArray(report[0]?.files))return report;
    } catch {}
  }
  throw new Error('npm pack did not return one complete JSON package report');
}
