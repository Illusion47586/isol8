/**
 * @module engine/pool
 *
 * Warm container pool for fast ephemeral execution. Pre-creates and
 * starts containers so they're ready for immediate use, eliminating
 * the create+start overhead (~100-200ms per execution).
 *
 * Supports two strategies:
 * - "secure": Clean container before returning (slower but ensures clean state)
 * - "fast": Dual-pool system - instant acquire from clean pool, background cleanup
 */

import type Docker from "dockerode";
import { logger } from "../utils/logger";

/** Configuration for the container pool. */
export interface PoolOptions {
  /** Docker client instance. */
  docker: Docker;
  /** Pool strategy: "secure" or "fast". @default "fast" */
  poolStrategy?: "secure" | "fast";
  /** Pool size configuration.
   * For "secure" mode: number of containers to keep warm
   * For "fast" mode: { clean: ready containers, dirty: being cleaned }
   * @default 1 (for fast mode: { clean: 1, dirty: 1 })
   */
  poolSize?: number | { clean: number; dirty: number };
  /** Container creation options (HostConfig, Env, etc). */
  createOptions: Omit<Docker.ContainerCreateOptions, "Image">;
  /** Network mode to determine if iptables cleanup is needed. */
  networkMode: "none" | "host" | "filtered";
  /** Security mode - if strict, run process cleanup between executions */
  securityMode: "strict" | "unconfined" | "custom";
}

interface PoolEntry {
  container: Docker.Container;
  createdAt: number;
}

interface PoolState {
  clean: PoolEntry[];
  dirty: PoolEntry[];
}

/**
 * A per-image warm container pool. Maintains pre-started containers
 * ready for immediate exec, recycling them after use.
 *
 * Supports two strategies:
 * - "secure": Single pool, cleanup in acquire (current behavior)
 * - "fast": Dual pools (clean/dirty), instant acquire, background cleanup
 */
export class ContainerPool {
  private readonly docker: Docker;
  private readonly poolStrategy: "secure" | "fast";
  private readonly cleanPoolSize: number;
  private readonly dirtyPoolSize: number;
  private readonly createOptions: Omit<Docker.ContainerCreateOptions, "Image">;
  private readonly networkMode: "none" | "host" | "filtered";
  private readonly securityMode: "strict" | "unconfined" | "custom";
  private readonly pools = new Map<string, PoolState>();
  private readonly replenishing = new Set<string>();
  private readonly pendingReplenishments = new Set<Promise<void>>();
  private cleaningInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: PoolOptions) {
    this.docker = options.docker;
    this.poolStrategy = options.poolStrategy ?? "fast";
    this.createOptions = options.createOptions;
    this.networkMode = options.networkMode;
    this.securityMode = options.securityMode;

    // Parse pool size
    if (typeof options.poolSize === "number") {
      this.cleanPoolSize = options.poolSize;
      this.dirtyPoolSize = options.poolSize;
    } else if (options.poolSize) {
      this.cleanPoolSize = options.poolSize.clean ?? 1;
      this.dirtyPoolSize = options.poolSize.dirty ?? 1;
    } else {
      // Default: 1 clean, 1 dirty for fast mode
      this.cleanPoolSize = 1;
      this.dirtyPoolSize = 1;
    }

    // Start background cleaning for fast mode
    if (this.poolStrategy === "fast") {
      this.startBackgroundCleaning();
    }
  }

  /**
   * Acquire a started container for the given image.
   * - "secure" mode: Clean container before returning
   * - "fast" mode: Instant return from clean pool, create new if empty
   */
  async acquire(image: string): Promise<Docker.Container> {
    const pool = this.pools.get(image) ?? { clean: [], dirty: [] };

    if (this.poolStrategy === "fast") {
      // Fast mode: instant acquire from clean pool
      if (pool.clean.length > 0) {
        const entry = pool.clean.shift()!;
        this.pools.set(image, pool);

        // Fire-and-forget replenishment
        this.replenish(image);

        // Fire-and-forget dirty pool cleanup
        this.cleanDirtyContainer(image);

        return entry.container;
      }

      // No clean containers available, create new one
      return this.createContainer(image);
    }
    // Secure mode: single pool, clean before returning
    if (pool.clean && pool.clean.length > 0) {
      const entry = pool.clean.shift()!;
      this.pools.set(image, { clean: pool.clean, dirty: [] });

      // Clean before returning - this ensures container is ready
      await this.cleanupContainer(entry.container);

      // Fire-and-forget replenishment
      this.replenish(image);
      return entry.container;
    }

    // Cold path: create + start inline
    return this.createContainer(image);
  }

  /**
   * Return a container to the pool.
   * - "secure" mode: Add to pool, cleanup happens on next acquire
   * - "fast" mode: Add to dirty pool for background cleaning
   */
  async release(container: Docker.Container, image: string): Promise<void> {
    let pool = this.pools.get(image);

    if (!pool) {
      pool = { clean: [], dirty: [] };
      this.pools.set(image, pool);
    }

    if (this.poolStrategy === "fast") {
      // Fast mode: add to dirty pool
      if (pool.dirty.length >= this.dirtyPoolSize) {
        // Dirty pool full, destroy container
        await container.remove({ force: true }).catch(() => {});
        return;
      }

      pool.dirty.push({ container, createdAt: Date.now() });
    } else {
      // Secure mode: add to clean pool
      if (pool.clean.length >= this.cleanPoolSize) {
        await container.remove({ force: true }).catch(() => {});
        return;
      }

      // For secure mode, we use single array
      if (!pool.clean) {
        pool.clean = [];
      }
      pool.clean.push({ container, createdAt: Date.now() });
    }
  }

  /**
   * Clean a container from the dirty pool and move to clean pool.
   * Runs in background.
   */
  private cleanDirtyContainer(image: string): void {
    const pool = this.pools.get(image);
    if (!pool || pool.dirty.length === 0) {
      return;
    }

    // Take one from dirty pool
    const entry = pool.dirty.shift()!;

    // Clean in background (don't await)
    this.cleanupContainer(entry.container)
      .then(() => {
        // If clean pool has space, add it back
        if (pool.clean.length < this.cleanPoolSize) {
          pool.clean.push(entry);
        } else {
          // Clean pool full, destroy
          entry.container.remove({ force: true }).catch(() => {});
        }
      })
      .catch(() => {
        // Cleanup failed, destroy container
        entry.container.remove({ force: true }).catch(() => {});
      });
  }

  /**
   * Start background cleaning for fast mode.
   * Continuously cleans dirty containers and moves them to clean pool.
   */
  private startBackgroundCleaning(): void {
    this.cleaningInterval = setInterval(async () => {
      for (const [_image, pool] of this.pools) {
        // Clean up to dirtyPoolSize containers per cycle
        for (let i = 0; i < this.dirtyPoolSize; i++) {
          if (pool.dirty.length > 0 && pool.clean.length < this.cleanPoolSize) {
            const entry = pool.dirty.shift()!;

            try {
              await this.cleanupContainer(entry.container);
              pool.clean.push(entry);
            } catch {
              entry.container.remove({ force: true }).catch(() => {});
            }
          }
        }
      }
    }, 10); // Run every 10ms for near-instant cleaning
  }

  private async cleanupContainer(container: Docker.Container): Promise<void> {
    const needsCleanup = this.securityMode === "strict";
    const needsIptables = this.networkMode === "filtered" && needsCleanup;

    if (!needsCleanup) {
      return;
    }

    try {
      const cleanupCmd = needsIptables
        ? "pkill -9 -u sandbox 2>/dev/null; /usr/sbin/iptables -F OUTPUT 2>/dev/null; rm -rf /sandbox/* /sandbox/.[!.]* 2>/dev/null; true"
        : "pkill -9 -u sandbox 2>/dev/null; rm -rf /sandbox/* /sandbox/.[!.]* 2>/dev/null; true";

      const cleanExec = await container.exec({
        Cmd: ["sh", "-c", cleanupCmd],
      });
      await cleanExec.start({ Detach: true });

      let info = await cleanExec.inspect();
      while (info.Running) {
        await new Promise((r) => setTimeout(r, 5));
        info = await cleanExec.inspect();
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Pre-warm the pool for a specific image.
   */
  async warm(image: string): Promise<void> {
    const pool = this.pools.get(image) ?? { clean: [], dirty: [] };
    this.pools.set(image, pool);

    const needed =
      this.poolStrategy === "fast"
        ? this.cleanPoolSize - pool.clean.length
        : this.cleanPoolSize - (pool.clean?.length ?? 0);

    if (needed <= 0) {
      return;
    }

    const promises: Promise<void>[] = [];

    for (let i = 0; i < needed; i++) {
      promises.push(
        this.createContainer(image).then((container) => {
          if (this.poolStrategy === "fast") {
            pool.clean.push({ container, createdAt: Date.now() });
          } else {
            if (!pool.clean) {
              pool.clean = [];
            }
            pool.clean.push({ container, createdAt: Date.now() });
          }
        })
      );
    }

    await Promise.all(promises);
  }

  /**
   * Destroy all pooled containers and clear the pool.
   */
  async drain(): Promise<void> {
    // Stop background cleaning
    if (this.cleaningInterval) {
      clearInterval(this.cleaningInterval);
      this.cleaningInterval = null;
    }

    // Wait for pending operations
    await Promise.all(this.pendingReplenishments);

    const promises: Promise<void>[] = [];

    for (const [, pool] of this.pools) {
      for (const entry of pool.clean ?? []) {
        promises.push(entry.container.remove({ force: true }).catch(() => {}));
      }
      for (const entry of pool.dirty) {
        promises.push(entry.container.remove({ force: true }).catch(() => {}));
      }
    }

    await Promise.all(promises);
    this.pools.clear();
  }

  private async createContainer(image: string): Promise<Docker.Container> {
    const container = await this.docker.createContainer({
      ...this.createOptions,
      Image: image,
    });
    logger.debug(`[Pool] Container ${container.id} created for image: ${image}`);
    await container.start();
    logger.debug(`[Pool] Container ${container.id} started`);
    return container;
  }

  private replenish(image: string): void {
    if (this.replenishing.has(image)) {
      if (this.replenishing.has(image)) {
        return;
      }

      const pool = this.pools.get(image);
      const currentSize = pool
        ? this.poolStrategy === "fast"
          ? pool.clean.length
          : (pool.clean?.length ?? 0)
        : 0;
      const targetSize = this.poolStrategy === "fast" ? this.cleanPoolSize : this.cleanPoolSize;

      if (currentSize >= targetSize) {
        return;
      }

      this.replenishing.add(image);

      const promise = this.createContainer(image)
        .then((container) => {
          const p = this.pools.get(image);
          if (!p) {
            container.remove({ force: true }).catch(() => {});
            return;
          }

          if (this.poolStrategy === "fast") {
            if (p.clean.length < this.cleanPoolSize) {
              p.clean.push({ container, createdAt: Date.now() });
            } else {
              container.remove({ force: true }).catch(() => {});
            }
          } else {
            if (!p.clean) {
              p.clean = [];
            }
            if (p.clean.length < this.cleanPoolSize) {
              p.clean.push({ container, createdAt: Date.now() });
            } else {
              container.remove({ force: true }).catch(() => {});
            }
          }
        })
        .catch((err) => {
          logger.error(`[Pool] Error during replenishment for ${image}:`, err);
        })
        .finally(() => {
          this.replenishing.delete(image);
          this.pendingReplenishments.delete(promise);
        });

      this.pendingReplenishments.add(promise);
    }
  }
}
