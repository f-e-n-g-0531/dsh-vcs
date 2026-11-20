import {getSvnBasicChallengeRealm} from './bounded-https.mjs';
import {validateSvnDavLink} from './svn-dav-link.mjs';

// Internal seam only. The broker must resolve exactly the supplied realm without
// prompting or saving credentials. Do not expose this function directly via RPC.
export function createSvnCacheChallengeRequest({request, readCredential, assertAuthorized, root}) {
  const expectedOrigin = new URL(root).origin;
  const authFailure = () => Object.assign(Error('SVN cached login unavailable or rejected'), {code:'vcs/svn-auth-required'});
  const check = async signal => {
    signal?.throwIfAborted();
    await assertAuthorized();
    signal?.throwIfAborted();
  };
  return async (url, options) => {
    validateSvnDavLink(url, {root});
    if (options.origin !== expectedOrigin || options.authentication !== undefined) throw Error('Invalid SVN cache request scope');
    await check(options.signal);
    try {
      const result = await request(url, options);
      await check(options.signal);
      return result;
    } catch (error) {
      if (error?.code !== 'vcs/svn-auth-required') throw error;
      const realm = getSvnBasicChallengeRealm(error);
      if (!realm) throw authFailure();
      await check(options.signal);
      let credential;
      try { credential = await readCredential(realm, {signal:options.signal}); }
      catch { options.signal?.throwIfAborted(); throw authFailure(); }
      await check(options.signal);
      const {username,password} = credential || {};
      if (typeof username !== 'string' || !username || Buffer.byteLength(username) > 256
        || typeof password !== 'string' || !password || Buffer.byteLength(password) > 1024
        || /[:\x00-\x1f\x7f]/.test(username) || /[\x00-\x1f\x7f]/.test(password)) throw authFailure();
      const bytes = Buffer.from(username + ':' + password);
      let header;
      try { header = 'Basic ' + bytes.toString('base64'); }
      finally { bytes.fill(0); }
      try {
        const result = await request(url, {...options, authentication:{root,header}});
        await check(options.signal);
        return result;
      } catch (failure) {
        if (failure?.code === 'vcs/svn-auth-required') throw authFailure();
        throw failure;
      }
    }
  };
}
