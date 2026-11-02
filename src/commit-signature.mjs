// Signature presence only: Git stores SSH and OpenPGP armor in gpgsig or
// gpgsig-sha256 multiline headers. The suffix names the object hash, not the
// signature algorithm. This never invokes a verifier or implies trust.
export function parseCommitSignature(raw) {
  const none = {signed:false, format:null};
  if (typeof raw !== 'string') return none;
  const lf = String.fromCharCode(10);
  const boundary = raw.indexOf(lf + lf);
  const header = boundary === -1 ? raw : raw.slice(0,boundary);
  const signatures = [];
  let current;
  for (const line of header.split(lf)) {
    if (line.startsWith(' ')) {
      if (current) current.push(line.slice(1));
      continue;
    }
    current = undefined;
    const match = /^(?:gpgsig|gpgsig-sha256) (.*)$/.exec(line);
    if (match) {current = [match[1]]; signatures.push(current);}
  }
  if (!signatures.length) return none;
  for (const signature of signatures) {
    const armor = signature.join(lf).trimStart();
    if (armor.startsWith('-----BEGIN SSH SIGNATURE-----' + lf)) return {signed:true,format:'SSH'};
    if (armor.startsWith('-----BEGIN PGP SIGNATURE-----' + lf)) return {signed:true,format:'OpenPGP'};
  }
  return {signed:true,format:'Unknown'};
}
