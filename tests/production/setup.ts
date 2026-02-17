/**
 * Production test setup - Docker is REQUIRED, no mocking.
 */

import { beforeAll } from "bun:test";
import { execSync } from "node:child_process";
import Docker from "dockerode";

// Check Docker availability - FAIL HARD if not available
async function checkDocker(): Promise<void> {
  try {
    const docker = new Docker();
    await docker.ping();
  } catch {
    throw new Error(
      "\n" +
        "=".repeat(70) +
        "\nDOCKER IS REQUIRED FOR PRODUCTION TESTS\n" +
        "=".repeat(70) +
        "\n\nDocker is not available or not running.\n" +
        "Production tests require an actual Docker daemon.\n\n" +
        "To run locally:\n" +
        "  - macOS: open -a Docker\n" +
        "  - Linux: sudo systemctl start docker\n\n" +
        "=".repeat(70) +
        "\n"
    );
  }
}

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
  await checkDocker();
  await prebuildImages();
}, 300_000); // 5 minute timeout
