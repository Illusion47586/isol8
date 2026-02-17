/**
 * @module engine/image-builder
 *
 * Builds Docker images for each supported runtime. Base images are built from
 * the multi-stage `docker/Dockerfile`. Custom images layer user-specified
 * packages on top of the base images.
 */

import { existsSync } from "node:fs";
import type Docker from "dockerode";
import { RuntimeRegistry } from "../runtime";
import type { Isol8Config } from "../types";

/**
 * Resolve the `docker/` directory containing the Dockerfile and proxy.
 *
 * When running from source (`src/engine/image-builder.ts`), the path is
 * `../../docker` relative to this file. When running from the bundled CLI
 * (`dist/cli.js`), it is `./docker` (same directory). We try both and use
 * whichever exists.
 */
function resolveDockerDir(): string {
  // Try production/bundled path first: dist/cli.js -> ./docker
  const fromBundled = new URL("./docker", import.meta.url).pathname;
  if (existsSync(fromBundled)) {
    return fromBundled;
  }
  // Fallback to dev path: src/engine/image-builder.ts -> ../../docker
  return new URL("../../docker", import.meta.url).pathname;
}

const DOCKERFILE_DIR = resolveDockerDir();

/** Progress update emitted during image builds. */
interface BuildProgress {
  /** Runtime being built (e.g. `"python"`). */
  runtime: string;
  /** Current build status. */
  status: "building" | "done" | "error";
  /** Optional status message (error text, package list, etc). */
  message?: string;
}

type ProgressCallback = (progress: BuildProgress) => void;

/**
 * Builds the base `isol8:<runtime>` images for all registered runtimes.
 * Each image is built from the multi-stage Dockerfile in `docker/`.
 *
 * @param docker - Dockerode instance.
 * @param onProgress - Optional callback for build progress updates.
 */
export async function buildBaseImages(
  docker: Docker,
  onProgress?: ProgressCallback
): Promise<void> {
  const runtimes = RuntimeRegistry.list();

  for (const adapter of runtimes) {
    const target = adapter.name;
    onProgress?.({ runtime: target, status: "building" });

    try {
      const stream = await docker.buildImage(
        { context: DOCKERFILE_DIR, src: ["Dockerfile", "proxy.sh", "proxy-handler.sh"] },
        {
          t: adapter.image,
          target,
          dockerfile: "Dockerfile",
        }
      );

      // Wait for build to complete
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      onProgress?.({ runtime: target, status: "done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress?.({ runtime: target, status: "error", message });
      throw new Error(`Failed to build image for ${target}: ${message}`);
    }
  }
}

/**
 * Builds custom images with user-specified dependencies layered on top of
 * the base images. Reads package lists from the config's `dependencies` field.
 *
 * @param docker - Dockerode instance.
 * @param config - Resolved isol8 configuration.
 * @param onProgress - Optional callback for build progress updates.
 */
export async function buildCustomImages(
  docker: Docker,
  config: Isol8Config,
  onProgress?: ProgressCallback
): Promise<void> {
  const deps = config.dependencies;

  if (deps.python?.length) {
    await buildCustomImage(docker, "python", deps.python, onProgress);
  }
  if (deps.node?.length) {
    await buildCustomImage(docker, "node", deps.node, onProgress);
  }
  if (deps.bun?.length) {
    await buildCustomImage(docker, "bun", deps.bun, onProgress);
  }
  if (deps.deno?.length) {
    await buildCustomImage(docker, "deno", deps.deno, onProgress);
  }
  if (deps.bash?.length) {
    await buildCustomImage(docker, "bash", deps.bash, onProgress);
  }
}

async function buildCustomImage(
  docker: Docker,
  runtime: string,
  packages: string[],
  onProgress?: ProgressCallback
): Promise<void> {
  const tag = `isol8:${runtime}-custom`;
  onProgress?.({ runtime, status: "building", message: `Custom: ${packages.join(", ")}` });

  // Generate a Dockerfile that extends the base image
  let installCmd: string;
  switch (runtime) {
    case "python":
      installCmd = `RUN pip install --no-cache-dir ${packages.join(" ")}`;
      break;
    case "node":
      installCmd = `RUN npm install -g ${packages.join(" ")}`;
      break;
    case "bun":
      installCmd = `RUN bun install -g ${packages.join(" ")}`;
      break;
    case "deno":
      // Deno uses URL imports, but we can pre-cache
      installCmd = packages.map((p) => `RUN deno cache ${p}`).join("\n");
      break;
    case "bash":
      installCmd = `RUN apk add --no-cache ${packages.join(" ")}`;
      break;
    default:
      throw new Error(`Unknown runtime: ${runtime}`);
  }

  const dockerfileContent = `FROM isol8:${runtime}\n${installCmd}\n`;

  // Build using dockerode with an inline tar containing just the Dockerfile
  // Build using dockerode with an inline tar containing just the Dockerfile
  const { createTarBuffer, validatePackageName } = await import("./utils");
  const { Readable } = await import("node:stream");

  // Validate all packages before building
  packages.forEach(validatePackageName);

  const tarBuffer = createTarBuffer("Dockerfile", dockerfileContent);

  const stream = await docker.buildImage(Readable.from(tarBuffer), {
    t: tag,
    dockerfile: "Dockerfile",
  });

  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  onProgress?.({ runtime, status: "done" });
}

/**
 * Checks if an image exists locally.
 */
export async function imageExists(docker: Docker, imageName: string): Promise<boolean> {
  try {
    await docker.getImage(imageName).inspect();
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures all base images are built.
 */
export async function ensureImages(docker: Docker, onProgress?: ProgressCallback): Promise<void> {
  const runtimes = RuntimeRegistry.list();

  const missing: string[] = [];
  for (const adapter of runtimes) {
    if (!(await imageExists(docker, adapter.image))) {
      missing.push(adapter.name);
    }
  }

  if (missing.length > 0) {
    await buildBaseImages(docker, onProgress);
  }
}
