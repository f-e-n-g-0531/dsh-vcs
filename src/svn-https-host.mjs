import {createSvnHost} from './svn-host.mjs';
import {createBoundedHttps} from './bounded-https.mjs';
import {createSvnDavLogTransport} from './svn-dav-log-transport.mjs';

// Production composition: no CLI, auth cache, custom CA or request injection.
export function createSvnHttpsHost(ctx, api) {
  return createSvnHost(ctx, api, {
    transportFormat: 'dav',
    transport: createSvnDavLogTransport({request: createBoundedHttps()}),
  });
}
