// Start independent reads together, drain ALL siblings, then consume errors in input order.
export async function settledReads(reads,signal){
 const settled=await Promise.allSettled(reads.map(read=>Promise.resolve().then(read)));
 // Prefer caller cancellation after every sibling has settled.
 signal?.throwIfAborted();
 const values=[];for(const row of settled){if(row.status==='rejected')throw row.reason;values.push(row.value);}return values;
}
