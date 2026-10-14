// SPDX-License-Identifier: EUPL-1.2
import { sleep } from './sleep.js';

/**
 * Token bucket for `partner_integrations.max_requests_per_second`: refills at
 * `rate` tokens per second, holds at most max(1, rate) tokens (no larger bursts).
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly rate: number,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number, signal?: AbortSignal) => Promise<void> = sleep,
  ) {
    if (!(rate > 0)) throw new RangeError('rate must be > 0');
    this.capacity = Math.max(1, rate);
    this.tokens = this.capacity;
    this.last = now();
  }

  /** Resolves when a request may be sent; callers are served in order. */
  acquire(signal?: AbortSignal): Promise<void> {
    const turn = this.queue.then(() => this.take(signal));
    // A rejected turn (abort) must not block later callers.
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async take(signal?: AbortSignal): Promise<void> {
    for (;;) {
      signal?.throwIfAborted();
      const now = this.now();
      this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.rate);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.wait(Math.ceil(((1 - this.tokens) / this.rate) * 1000), signal);
    }
  }
}
