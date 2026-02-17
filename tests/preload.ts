import { afterAll } from "bun:test";

afterAll(async () => {
  try {
    const Docker = (await import("dockerode")).default;
    const docker = new Docker();
    await docker.ping();

    const { DockerIsol8 } = await import("../src/engine/docker");
    const result = await DockerIsol8.cleanup(docker);

    if (result.removed > 0) {
      console.log(
        `[cleanup] Removed ${result.removed} isol8 container(s)` +
          (result.failed > 0 ? `, ${result.failed} failed` : "")
      );
    }
  } catch {
    // Docker not available, nothing to clean up
  }
});
