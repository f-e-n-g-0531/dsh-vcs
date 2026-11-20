import {readWindowsSvnCache} from './svn-windows-cache.mjs';
import {createSvnHost} from './svn-host.mjs';
import {createBoundedHttps} from './bounded-https.mjs';
import {createSvnDavLogTransport} from './svn-dav-log-transport.mjs';

// Explicit process configuration; neither worktree files nor browser RPC carry credentials.
export function readHostBasicCredentials({root, uuid, sessionId}, includeSecret, env = process.env) {
  if (!root || root !== env.DSH_VCS_SVN_BASIC_ROOT || !uuid || uuid !== env.DSH_VCS_SVN_BASIC_UUID
    || !sessionId || sessionId !== env.DSH_VCS_SVN_BASIC_SESSION) return undefined;
  if (!env.DSH_VCS_SVN_BASIC_USERNAME || !env.DSH_VCS_SVN_BASIC_PASSWORD) return undefined;
  return includeSecret ? {
    username: env.DSH_VCS_SVN_BASIC_USERNAME,
    password: env.DSH_VCS_SVN_BASIC_PASSWORD,
  } : true;
}

// Network transport stays in-process DAV; Windows may use a local credential provider.
export function createSvnHttpsHost(ctx, api) {
  return createSvnHost(ctx, api, {
    transportFormat: 'dav',
    readBasicCredentials: readHostBasicCredentials,
    readCachedCredential: process.platform === 'win32' ? readWindowsSvnCache : undefined,
    transport: createSvnDavLogTransport({request: createBoundedHttps()}),
  });
}
