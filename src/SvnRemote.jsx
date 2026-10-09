import {watchSvnExpiry, validateSvnUiGrant} from './svn-ui-expiry.mjs';
import React, {useEffect, useState} from 'react';
import SvnConsent from './SvnConsent.jsx';
import SvnHistory from './SvnHistory.jsx';

// Network reads start only after explicit scoped approval; teardown revokes the grant.
export default function SvnRemote(props) {
  return <Scoped key={JSON.stringify([props.sessionId, props.repositoryId])} {...props}/>;
}

function Scoped({sessionId, repositoryId, rpc, t, onRediscover}) {
  const [grant, setGrant] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  // Best-effort cleanup is independent of any already-aborted view request.
  useEffect(() => {
    if (!grant) return;
    return () => {
      Promise.resolve().then(() => rpc('vcs/svn-revoke', {
        sessionId, repositoryId, token: grant.token,
      })).catch(() => {});
    };
  }, [grant, sessionId, repositoryId]);

  // One-shot expiry returns to consent; it never renews or initiates network IO.
  useEffect(() => {
    if (!grant) return;
    try {
      return watchSvnExpiry(grant.expiresAt, () => {
        setGrant(null);
        setAttempt(0);
        setRevoking(false);
        setError(t('svnExpired'));
      });
    } catch {
      setGrant(null);
      setError(t('svnExpired'));
    }
  }, [grant]);

  useEffect(() => {
    if (!attempt || !grant) return;
    const controller = new AbortController();
    setRevoking(true);
    setError('');
    rpc('vcs/svn-revoke', {sessionId, repositoryId, token: grant.token}, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setGrant(null);
      })
      .catch(failure => {
        if (!controller.signal.aborted) {
          setError(failure.message);
          if (failure.code === 'vcs/rediscover-required') onRediscover();
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRevoking(false);
      });
    return () => controller.abort();
  }, [attempt, grant]);

  const onApproved = value => {
    try {
      validateSvnUiGrant(value);
      setError('');
      setAttempt(0);
      setGrant(value);
    } catch (failure) {
      setError(failure.message);
    }
  };

  const historyRpc = async (...args) => {
    try {
      return await rpc(...args);
    } catch (failure) {
      // A late cancelled request must not invalidate the current consent view.
      if (failure.code === 'vcs/svn-consent-required' && !args[2]?.aborted) {
        setGrant(null);
        setAttempt(0);
        setError(t('svnExpired'));
      }
      throw failure;
    }
  };

  return <section>
    {!grant && error && <p role="status">{error}</p>}
    {!grant ? <SvnConsent {...{sessionId, repositoryId, rpc, t, onRediscover}} onApproved={onApproved}/> : <>
      <p>{t('svnGrantScope')}</p>
      <button disabled={revoking} onClick={() => setAttempt(value => value + 1)}>{t('svnRevoke')}</button>
      {error && <p role="alert">{error}</p>}
      {!revoking && <SvnHistory {...{sessionId, repositoryId, t, onRediscover}}
        rpc={historyRpc} token={grant.token} snapshot={grant.snapshot}/>}
    </>}
  </section>;
}
