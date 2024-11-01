import type { JobOptions } from '../types/index.js';

export function calculateBackoff(attempts: number, opts: JobOptions): number {
  const backoff = opts.backoff;
  if (!backoff) return 0;

  const delay = backoff.delay || 1000;

  switch (backoff.type) {
    case 'exponential':
      return delay * Math.pow(2, attempts - 1);
    case 'fixed':
      return delay;
    default:
      return 0;
  }
}
