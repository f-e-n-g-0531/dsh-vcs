/** Wait for test state without hiding a request that settles before reaching it. */
export function waitForReadiness(isReady, pending = [], {
  timeoutMs = 1000,
  intervalMs = 1,
  label = 'readiness',
} = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    let pollTimer;
    let deadlineTimer;
    const finish = (...errors) => {
      if (done) return;
      done = true;
      clearTimeout(pollTimer);
      clearTimeout(deadlineTimer);
      if (errors.length) reject(errors[0]);
      else resolve();
    };
    const check = () => {
      if (done) return true;
      try {
        if (isReady()) {
          finish();
          return true;
        }
      } catch (error) {
        finish(error);
        return true;
      }
      return false;
    };

    // Attach both handlers synchronously, even when the initial state is ready.
    // Their returned promises cannot reject, including after this wait finishes.
    for (const request of pending) {
      Promise.resolve(request).then(
        () => {
          if (!check()) finish(new Error('Request fulfilled before ' + label));
        },
        error => finish(error),
      );
    }
    if (check()) return;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      finish(new RangeError('Readiness timeout and polling interval must be finite and non-negative/positive'));
      return;
    }
    deadlineTimer = setTimeout(() => finish(new Error(
      'Timed out waiting for ' + label + ' after ' + timeoutMs + 'ms',
    )), timeoutMs);
    const poll = () => {
      if (!check()) pollTimer = setTimeout(poll, intervalMs);
    };
    pollTimer = setTimeout(poll, intervalMs);
  });
}
