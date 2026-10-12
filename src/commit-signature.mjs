// Bounded commit-signature presence detection from the raw commit-object header.
// Read-only by design: only inspects the header for gpgsig / gpgsig-sha256 / sshsig
// markers. It never runs gpg/ssh-keygen verification, never touches the network, and
// never writes. A result of {signed:true} means "a signature header is present", not
// "trust-verified".
export function parseCommitSignature(raw) {
  const none = { signed: false, format: null };
  if (typeof raw !== 'string') return none;
  const boundary = raw.indexOf('\n\n');
  const header = boundary === -1 ? raw : raw.slice(0, boundary);
  if (/^sshsig /m.test(header)) return { signed: true, format: 'SSH' };
  if (/^gpgsig-sha256 /m.test(header)) return { signed: true, format: 'OpenPGP-SHA256' };
  if (/^gpgsig /m.test(header)) return { signed: true, format: 'OpenPGP' };
  return none;
}