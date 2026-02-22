import { beforeAll } from "bun:test";
import { buildBaseImages } from "@isol8/core";
import Docker from "dockerode";

// Check if Docker is available
const docker = new Docker();
export const hasDocker = await (async () => {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
})();

// Build images once before all tests
if (hasDocker) {
  beforeAll(async () => {
    // Set a longer timeout for image building
    await buildBaseImages(docker, () => {});
  }, 300_000); // 5 minutes
}

export function getDocker() {
  if (!hasDocker) {
    throw new Error("Docker not available");
  }
  return docker;
}
