import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';

const operations = new AsyncLocalStorage();
export const operationTimeout = () => Object.assign(new Error('VCS operation deadline exceeded.'), {code: 'TIMEOUT'});

/** One monotonic deadline per RPC. Nested commands never reset this budget. */
export async function withOperationBudget({signal, timeoutMs = 15000} = {}, work) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw new Error('Invalid operation timeout.');
  const parent = operations.getStore();
  const deadline = Math.min(performance.now() + timeoutMs, parent?.deadline ?? Infinity);
  const controller = new AbortController();
  const signals = [signal, parent?.signal].filter(Boolean);
  const abort = () => {
    const source = signals.find(value => value.aborted);
    if (source) controller.abort(source.reason);
  };
  for (const source of signals) source.addEventListener('abort', abort, {once: true});
  abort();
  const timer = setTimeout(() => controller.abort(operationTimeout()), Math.max(1, Math.ceil(deadline - performance.now())));
  const budget = {
    deadline,
    signal: controller.signal,
    remaining() {
      this.throwIfExpired();
      return Math.max(1, Math.ceil(deadline - performance.now()));
    },
    throwIfExpired() {
      if (!controller.signal.aborted && performance.now() >= deadline) controller.abort(operationTimeout());
      controller.signal.throwIfAborted();
    },
  };
  try {
    budget.throwIfExpired();
    const value = await operations.run(budget, work);
    budget.throwIfExpired();
    return value;
  } finally {
    clearTimeout(timer);
    for (const source of signals) source.removeEventListener('abort', abort);
  }
}

export const currentOperationBudget = () => operations.getStore();
