/**
 * Utility functions for production tests
 */

import { exec, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getTestVersion } from "./setup";

const execAsync = promisify(exec);

/**
 * Run isol8 command via bunx
 */
export async function runIsol8(
  args: string,
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  } = {}
) {
  const version = getTestVersion();
  const command = `bunx isol8@${version} ${args}`;

  return execAsync(command, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...options.env },
    timeout: options.timeout || 60_000,
  });
}

/**
 * Spawn isol8 command for streaming tests
 */
export function spawnIsol8(
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
  } = {}
) {
  const version = getTestVersion();
  return spawn("bunx", [`isol8@${version}`, ...args], {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...options.env },
  });
}

/**
 * Create a temporary directory for isolated tests
 */
export function createTempDir(prefix = "isol8-prod-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Clean up a temporary directory
 */
export function cleanupTempDir(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Wait for a server to be ready on a port
 */
export async function waitForServer(port: number, timeout = 30_000): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return false;
}

/**
 * Get a random port for testing
 */
export function getRandomPort(): number {
  // Use ports in the range 30000-40000 to avoid conflicts
  return 30_000 + Math.floor(Math.random() * 10_000);
}
