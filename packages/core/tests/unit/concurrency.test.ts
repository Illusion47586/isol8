import { describe, expect, test } from "bun:test";
import { QueueFullError, QueueTimeoutError, Semaphore } from "../../src/engine/concurrency";

describe("Semaphore", () => {
  test("allows up to max concurrent acquisitions", async () => {
    const sem = new Semaphore(2);
    await sem.acquire(); // 1
    await sem.acquire(); // 2
    expect(sem.available).toBe(0);

    sem.release();
    expect(sem.available).toBe(1);
    sem.release();
    expect(sem.available).toBe(2);
  });

  test("queues beyond max", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let resolved = false;
    const p = sem.acquire().then(() => {
      resolved = true;
    });

    // Should not resolve yet
    await new Promise((r) => setTimeout(r, 50));
    expect(resolved).toBe(false);
    expect(sem.pending).toBe(1);

    sem.release();
    await p;
    expect(resolved).toBe(true);
    sem.release();
  });

  test("throws on max < 1", () => {
    expect(() => new Semaphore(0)).toThrow("max must be >= 1");
  });

  test("handles concurrent workload", async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let maxActive = 0;

    const work = async () => {
      await sem.acquire();
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      sem.release();
    };

    await Promise.all(Array.from({ length: 10 }, () => work()));
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  // ─── Stats ───

  test("stats returns current semaphore state", async () => {
    const sem = new Semaphore(3);
    expect(sem.stats).toEqual({
      current: 0,
      max: 3,
      available: 3,
      pending: 0,
    });

    await sem.acquire();
    expect(sem.stats).toEqual({
      current: 1,
      max: 3,
      available: 2,
      pending: 0,
    });
  });

  // ─── Queue Size Limit ───

  test("rejects with QueueFullError when queue is at capacity", async () => {
    const sem = new Semaphore(1, { maxSize: 2 });
    await sem.acquire(); // slot taken

    // Fill the queue
    const p1 = sem.acquire(); // queue: 1
    const p2 = sem.acquire(); // queue: 2

    // Queue is full — next acquire should reject immediately
    try {
      await sem.acquire();
      expect.unreachable("should have thrown QueueFullError");
    } catch (err) {
      expect(err).toBeInstanceOf(QueueFullError);
      const queueErr = err as QueueFullError;
      expect(queueErr.queueSize).toBe(2);
      expect(queueErr.maxSize).toBe(2);
    }

    // Clean up
    sem.release(); // resolves p1
    await p1;
    sem.release(); // resolves p2
    await p2;
    sem.release();
  });

  test("does not limit queue when maxSize is 0", async () => {
    const sem = new Semaphore(1, { maxSize: 0 });
    await sem.acquire();

    // Should not throw even with many queued
    const promises = Array.from({ length: 20 }, () => sem.acquire());
    expect(sem.pending).toBe(20);

    // Clean up
    for (let i = 0; i < 20; i++) {
      sem.release();
    }
    await Promise.all(promises);
    sem.release();
  });

  // ─── Queue Timeout ───

  test("rejects with QueueTimeoutError when waiting too long", async () => {
    const sem = new Semaphore(1, { timeoutMs: 100 });
    await sem.acquire(); // slot taken

    const start = Date.now();
    try {
      await sem.acquire();
      expect.unreachable("should have thrown QueueTimeoutError");
    } catch (err) {
      const elapsed = Date.now() - start;
      expect(err).toBeInstanceOf(QueueTimeoutError);
      const timeoutErr = err as QueueTimeoutError;
      expect(timeoutErr.timeoutMs).toBe(100);
      expect(timeoutErr.waitedMs).toBeGreaterThanOrEqual(90); // allow some timing slack
      expect(elapsed).toBeGreaterThanOrEqual(90);
    }

    // Pending should be 0 after timeout removed the entry
    expect(sem.pending).toBe(0);

    sem.release();
  });

  test("clears timeout when acquire resolves normally", async () => {
    const sem = new Semaphore(1, { timeoutMs: 500 });
    await sem.acquire(); // slot taken

    let resolved = false;
    const p = sem.acquire().then(() => {
      resolved = true;
    });

    // Release quickly — should resolve before timeout
    await new Promise((r) => setTimeout(r, 50));
    sem.release();
    await p;

    expect(resolved).toBe(true);
    expect(sem.pending).toBe(0);

    sem.release();
  });

  test("does not timeout when timeoutMs is 0", async () => {
    const sem = new Semaphore(1, { timeoutMs: 0 });
    await sem.acquire();

    let resolved = false;
    const p = sem.acquire().then(() => {
      resolved = true;
    });

    // Wait a bit — should not time out
    await new Promise((r) => setTimeout(r, 100));
    expect(resolved).toBe(false);
    expect(sem.pending).toBe(1);

    // Release to resolve
    sem.release();
    await p;
    expect(resolved).toBe(true);
    sem.release();
  });

  // ─── Combined Queue Limits ───

  test("handles both maxSize and timeoutMs together", async () => {
    const sem = new Semaphore(1, { maxSize: 1, timeoutMs: 100 });
    await sem.acquire(); // slot taken

    // First queued request — will timeout
    const p1 = sem.acquire().catch((err) => err);

    // Second request — queue full
    try {
      await sem.acquire();
      expect.unreachable("should have thrown QueueFullError");
    } catch (err) {
      expect(err).toBeInstanceOf(QueueFullError);
    }

    // Wait for timeout
    const result = await p1;
    expect(result).toBeInstanceOf(QueueTimeoutError);

    sem.release();
  });
});
