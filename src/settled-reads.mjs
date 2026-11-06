// Start independent reads together, drain ALL siblings, then consume errors in input order.
export async function settledReads(reads){
 const settled=await Promise.allSettled(reads.map(read=>Promise.resolve().then(read)));
 const values=[];for(const row of settled){if(row.status==='rejected')throw row.reason;values.push(row.value);}return values;
}
