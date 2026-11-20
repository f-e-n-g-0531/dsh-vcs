// Accept only an unambiguous single Basic challenge for the already approved HTTPS origin.
// The cache's realm key uses the same explicit port form as Subversion's Serf transport.
export function svnBasicCacheRealm(origin, challenge) {
  if (typeof origin !== 'string' || typeof challenge !== 'string' || challenge.length > 1024) return undefined;
  let target;
  try { target = new URL(origin); } catch { return undefined; }
  if (target.protocol !== 'https:' || target.origin !== origin
    || !/^[A-Za-z0-9.-]+$/.test(target.hostname)) return undefined;
  // Deliberately refuse combined challenges, escapes, duplicate parameters and non-ASCII realms.
  const match = /^Basic[ \t]+realm="([\x20-\x21\x23-\x5b\x5d-\x7e]{1,512})"(?:[ \t]*,[ \t]*charset="UTF-8")?[ \t]*(?![\s\S])/i.exec(challenge);
  if (!match) return undefined;
  return '<https://' + target.hostname + ':' + (target.port || '443') + '> ' + match[1];
}
