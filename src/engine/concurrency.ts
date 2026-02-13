/**
 * @module engine/concurrency
 *
 * Async semaphore for limiting the number of concurrent container executions.
 * Used by {@link DockerIsol8} to prevent resource exhaustion.
 */

/**
 * A counting semaphore for limiting concurrent async operations.
 *
 * @example
 * ```typescript
 * const sem = new Semaphore(3); // allow 3 concurrent operations
 *
 * await sem.acquire();
 * try {
 *   await doWork();
 * } finally {
 *   sem.release();
 * }
 * ```
 */
export class Semaphore {
  private current = 0;
  private readonly queue: (() => void)[] = [];

  /**
   * @param max - Maximum number of concurrent acquisitions. Must be ≥ 1.
   * @throws {Error} If `max` is less than 1.
   */
  constructor(private readonly max: number) {
    if (max < 1) {
      throw new Error("Semaphore max must be >= 1");
    }
  }

  /** The number of permits currently available. */
  get available(): number {
    return this.max - this.current;
  }

  /** The number of callers waiting to acquire a permit. */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Acquire a permit. Resolves immediately if one is available,
   * otherwise queues the caller until a permit is released.
   */
  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * Release a permit. If callers are queued, the next one is resolved.
   * Must be called exactly once for each successful `acquire()`.
   */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.current--;
    }
  }
}
