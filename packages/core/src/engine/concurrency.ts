/**
 * @module engine/concurrency
 *
 * Async semaphore for limiting the number of concurrent container executions.
 * Used by {@link DockerIsol8} to prevent resource exhaustion.
 *
 * Supports configurable queue limits and timeouts to prevent unbounded
 * queue growth and provide proper backpressure to callers.
 */

/**
 * Options for controlling the semaphore's internal waiting queue.
 */
export interface QueueOptions {
  /**
   * Maximum number of requests that can wait in the queue.
   * When the queue is full, `acquire()` rejects immediately with {@link QueueFullError}.
   * `0` means unlimited (no cap on queue size).
   * @default 0
   */
  maxSize?: number;

  /**
   * Maximum time in milliseconds a request can wait in the queue before timing out.
   * When exceeded, `acquire()` rejects with {@link QueueTimeoutError}.
   * `0` means unlimited (no timeout).
   * @default 30000
   */
  timeoutMs?: number;
}

/**
 * Thrown when a semaphore's waiting queue is at capacity and a new
 * `acquire()` call cannot be enqueued.
 */
export class QueueFullError extends Error {
  readonly queueSize: number;
  readonly maxSize: number;

  constructor(queueSize: number, maxSize: number) {
    super(`Queue is full (${queueSize}/${maxSize})`);
    this.name = "QueueFullError";
    this.queueSize = queueSize;
    this.maxSize = maxSize;
  }
}

/**
 * Thrown when a queued `acquire()` call exceeds the configured timeout
 * while waiting for a permit.
 */
export class QueueTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly waitedMs: number;

  constructor(timeoutMs: number, waitedMs: number) {
    super(`Queue timeout after ${waitedMs}ms (limit: ${timeoutMs}ms)`);
    this.name = "QueueTimeoutError";
    this.timeoutMs = timeoutMs;
    this.waitedMs = waitedMs;
  }
}

/** Snapshot of semaphore state for monitoring. */
export interface SemaphoreStats {
  /** Number of permits currently held. */
  current: number;
  /** Maximum number of permits. */
  max: number;
  /** Number of permits available for immediate acquisition. */
  available: number;
  /** Number of callers waiting in the queue. */
  pending: number;
}

/**
 * A counting semaphore for limiting concurrent async operations.
 *
 * Supports optional queue size limits and timeouts to provide
 * backpressure when the system is overloaded.
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
 *
 * @example
 * ```typescript
 * // With queue limits
 * const sem = new Semaphore(3, { maxSize: 10, timeoutMs: 5000 });
 *
 * try {
 *   await sem.acquire();
 *   await doWork();
 * } catch (err) {
 *   if (err instanceof QueueFullError) {
 *     // Queue is at capacity — reject immediately
 *   } else if (err instanceof QueueTimeoutError) {
 *     // Waited too long in queue
 *   }
 * } finally {
 *   sem.release();
 * }
 * ```
 */
export class Semaphore {
  private current = 0;
  private readonly queue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    enqueuedAt: number;
  }> = [];
  private readonly maxQueueSize: number;
  private readonly queueTimeoutMs: number;

  /**
   * @param max - Maximum number of concurrent acquisitions. Must be >= 1.
   * @param queueOptions - Optional queue size and timeout limits.
   * @throws {Error} If `max` is less than 1.
   */
  constructor(
    private readonly max: number,
    queueOptions?: QueueOptions
  ) {
    if (max < 1) {
      throw new Error("Semaphore max must be >= 1");
    }
    this.maxQueueSize = queueOptions?.maxSize ?? 0;
    this.queueTimeoutMs = queueOptions?.timeoutMs ?? 0;
  }

  /** The number of permits currently available. */
  get available(): number {
    return this.max - this.current;
  }

  /** The number of callers waiting to acquire a permit. */
  get pending(): number {
    return this.queue.length;
  }

  /** Snapshot of current semaphore state for monitoring. */
  get stats(): SemaphoreStats {
    return {
      current: this.current,
      max: this.max,
      available: this.available,
      pending: this.pending,
    };
  }

  /**
   * Acquire a permit. Resolves immediately if one is available,
   * otherwise queues the caller until a permit is released.
   *
   * @throws {QueueFullError} If the queue is at capacity (`maxSize > 0` and queue is full).
   * @throws {QueueTimeoutError} If the caller waits longer than `timeoutMs` in the queue.
   */
  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }

    // Check queue capacity
    if (this.maxQueueSize > 0 && this.queue.length >= this.maxQueueSize) {
      throw new QueueFullError(this.queue.length, this.maxQueueSize);
    }

    return new Promise<void>((resolve, reject) => {
      const entry = { resolve, reject, enqueuedAt: Date.now() };
      this.queue.push(entry);

      // Set up timeout if configured
      if (this.queueTimeoutMs > 0) {
        const timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            const waitedMs = Date.now() - entry.enqueuedAt;
            reject(new QueueTimeoutError(this.queueTimeoutMs, waitedMs));
          }
        }, this.queueTimeoutMs);

        // Store original resolve so we can clear the timer when resolved normally
        const originalResolve = entry.resolve;
        entry.resolve = () => {
          clearTimeout(timer);
          originalResolve();
        };
      }
    });
  }

  /**
   * Release a permit. If callers are queued, the next one is resolved.
   * Must be called exactly once for each successful `acquire()`.
   */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next.resolve();
    } else {
      this.current--;
    }
  }
}
