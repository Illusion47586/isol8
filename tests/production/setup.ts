/**
 * Production test setup - Docker is REQUIRED, no mocking.
 */

import { beforeAll } from "bun:test";
import { execSync } from "node:child_process";

// Get the isol8 version to test
export function getTestVersion(): string {
  return process.env.ISOL8_TEST_VERSION || "latest";
}

// Pre-build images to speed up tests
async function prebuildImages(): Promise<void> {
  const version = getTestVersion();
  const command = `bunx isol8@${version} setup`;

  console.log(`[Setup] Building isol8 images (version: ${version})...`);
  console.log(`[Setup] Command: ${command}`);

  try {
    execSync(command, {
      stdio: "inherit",
      timeout: 300_000, // 5 minutes
    });
  } catch {
    throw new Error(
      "Failed to build isol8 images. Ensure Docker is running and you have internet connectivity."
    );
  }
}

// Global setup
beforeAll(async () => {
  await prebuildImages();
}, 300_000); // 5 minute timeout
