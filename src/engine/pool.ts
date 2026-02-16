/**
 * @module engine/pool
 *
 * Warm container pool for fast ephemeral execution. Pre-creates and
 * starts containers so they're ready for immediate use, eliminating
 * the create+start overhead (~100-200ms per execution).
 *
 * After execution, containers are cleaned (sandbox wiped) and returned
 * to the pool for reuse rather than destroyed.
 */

import type Docker from "dockerode";
import { logger } from "../utils/logger";

/** Configuration for the container pool. */
export interface PoolOptions {
  /** Docker client instance. */
  docker: Docker;
  /** Max containers to keep warm per image. @default 2 */
  poolSize?: number;
  /** Container creation options (HostConfig, Env, etc). */
  createOptions: Omit<Docker.ContainerCreateOptions, "Image">;
}

interface PoolEntry {
  container: Docker.Container;
  createdAt: number;
}

/**
 * A per-image warm container pool. Maintains pre-started containers
 * ready for immediate exec, recycling them after use.
 */
export class ContainerPool {
  private readonly docker: Docker;
  private readonly poolSize: number;
  private readonly createOptions: Omit<Docker.ContainerCreateOptions, "Image">;
  private readonly pools = new Map<string, PoolEntry[]>();
  private readonly replenishing = new Set<string>();
  private readonly pendingReplenishments = new Set<Promise<void>>();

  constructor(options: PoolOptions) {
    this.docker = options.docker;
    this.poolSize = options.poolSize ?? 2;
    this.createOptions = options.createOptions;
  }

  /**
   * Acquire a started container for the given image.
   * Returns a warm container from the pool if available,
   * otherwise creates and starts a new one.
   */
  async acquire(image: string): Promise<Docker.Container> {
    const pool = this.pools.get(image);

    if (pool && pool.length > 0) {
      const entry = pool.shift()!;
      // Fire-and-forget replenishment
      this.replenish(image);
      return entry.container;
    }

    // Cold path: create + start inline
    return this.createContainer(image);
  }

  /**
   * Return a container to the pool after use. All processes owned by the
   * `sandbox` user are killed, and the `/sandbox` tmpfs is wiped clean
   * so the container is ready for the next execution.
   * If the pool is full, the container is destroyed instead.
   */
  async release(container: Docker.Container, image: string): Promise<void> {
    const pool = this.pools.get(image) ?? [];

    if (pool.length >= this.poolSize) {
      // Pool is full, just destroy
      await container.remove({ force: true }).catch(() => {});
      return;
    }

    try {
      // Kill all processes owned by the sandbox user to prevent process
      // persistence across executions. The container's init (tini + sleep)
      // runs as root, so it survives this kill. See: GitHub issue #3.
      const killExec = await container.exec({
        Cmd: ["sh", "-c", "pkill -9 -u sandbox 2>/dev/null; iptables -F OUTPUT 2>/dev/null; true"],
      });
      await killExec.start({ Detach: true });

      // Wait for kill to complete before wiping the filesystem
      let killInfo = await killExec.inspect();
      while (killInfo.Running) {
        await new Promise((r) => setTimeout(r, 5));
        killInfo = await killExec.inspect();
      }

      // Wipe the sandbox for next use
      const cleanExec = await container.exec({
        Cmd: ["sh", "-c", "rm -rf /sandbox/* /sandbox/.[!.]* 2>/dev/null; true"],
      });
      await cleanExec.start({ Detach: true });

      // Wait for clean to finish (fast operation on tmpfs)
      let info = await cleanExec.inspect();
      while (info.Running) {
        await new Promise((r) => setTimeout(r, 5));
        info = await cleanExec.inspect();
      }

      pool.push({ container, createdAt: Date.now() });
      this.pools.set(image, pool);
    } catch {
      // Container died, just remove it
      await container.remove({ force: true }).catch(() => {});
    }
  }

  /**
   * Pre-warm the pool for a specific image.
   * Creates containers up to poolSize.
   */
  async warm(image: string): Promise<void> {
    const pool = this.pools.get(image) ?? [];
    this.pools.set(image, pool);

    const needed = this.poolSize - pool.length;
    const promises: Promise<void>[] = [];

    for (let i = 0; i < needed; i++) {
      promises.push(
        this.createContainer(image).then((container) => {
          pool.push({ container, createdAt: Date.now() });
        })
      );
    }

    await Promise.all(promises);
  }

  /**
   * Destroy all pooled containers and clear the pool.
   */
  async drain(): Promise<void> {
    // First wait for any pending replenishments to finish
    await Promise.all(this.pendingReplenishments);

    const promises: Promise<void>[] = [];

    for (const [, pool] of this.pools) {
      for (const entry of pool) {
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

  /** Replenish the pool in the background (non-blocking). */
  private replenish(image: string): void {
    if (this.replenishing.has(image)) {
      logger.debug(`[Pool] Replenishment for ${image} already in progress`);
      return;
    }
    this.replenishing.add(image);
    logger.debug(`[Pool] Starting background replenishment for image: ${image}`);

    const promise = this.createContainer(image)
      .then((container) => {
        const pool = this.pools.get(image) ?? [];
        if (pool.length < this.poolSize) {
          pool.push({ container, createdAt: Date.now() });
          this.pools.set(image, pool);
          logger.debug(
            `[Pool] Replenished container ${container.id} added to pool for ${image}. Pool size: ${pool.length}`
          );
        } else {
          logger.debug(
            `[Pool] Replenished container ${container.id} not needed (pool for ${image} is full), destroying`
          );
          container.remove({ force: true }).catch((err) => {
            logger.error(
              `[Pool] Error destroying unneeded replenished container ${container.id}:`,
              err
            );
          });
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
