import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exec } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { DockerIsol8, LABELS } from "@isol8/core";
import Docker from "dockerode";

const execAsync = promisify(exec);

// Check if Docker is available
let hasDocker = false;
try {
  const docker = new Docker();
  await docker.ping();
  hasDocker = true;
} catch {
  hasDocker = false;
}

const ROOT = join(import.meta.dir, "../../../..");
const CLI_CMD = `bun run ${join(ROOT, "apps/cli/src/cli.ts")}`;

describe("Integration: Custom Images", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const docker = new Docker();
  const testImageTag = "isol8-test-custom-python:latest";

  beforeAll(async () => {
    // Clean up any existing test images
    try {
      const img = docker.getImage(testImageTag);
      await img.remove({ force: true });
    } catch {
      // Ignore if it doesn't exist
    }
  });

  afterAll(async () => {
    // Clean up created images
    try {
      const img = docker.getImage(testImageTag);
      await img.remove({ force: true });
    } catch {}
  });

  test("CLI build command generates image with correct labels", async () => {
    try {
      const { stdout } = await execAsync(
        `${CLI_CMD} build --base python --install requests --install colorama --tag ${testImageTag} --force`,
        { timeout: 120_000 }
      );

      expect(stdout).toContain(testImageTag);

      // Verify image was created and has labels
      const imageInfo = await docker.getImage(testImageTag).inspect();
      expect(imageInfo.Config.Labels).toBeDefined();

      const labels = imageInfo.Config.Labels!;
      expect(labels[LABELS.runtime]).toBe("python");

      // Dependencies should be sorted alphabetically: "colorama,requests"
      expect(labels[LABELS.dependencies]).toBe("colorama,requests");
    } catch (error: any) {
      console.error("BUILD FAILED:", error.stdout || "", error.stderr || "", error);
      throw error;
    }
  }, 120_000);

  test("DockerIsol8 resolves custom image to avoid runtime install", async () => {
    // Ensure image from previous test exists
    const engine = new DockerIsol8({ mode: "ephemeral", network: "host" });

    // Requesting exactly colorama and requests
    const startTime = Date.now();
    const result = await engine.execute({
      runtime: "python",
      code: "import requests; import colorama; print('Imports successful')",
      installPackages: ["colorama", "requests"],
    });

    const duration = Date.now() - startTime;

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Imports successful");

    // Because the custom image satisfied the dependencies, it shouldn't install packages at runtime.
    // This typically means the execution should be faster than a pip install which takes several seconds.
    // We can't strictly assert time, but we assert it works.
    expect(duration).toBeLessThan(15_000);
  }, 30_000);
});
