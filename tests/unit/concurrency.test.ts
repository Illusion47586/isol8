import { describe, expect, test } from "bun:test";
import { Semaphore } from "../../src/engine/concurrency";

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
});
