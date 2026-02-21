/**
 * @module engine/image-builder
 *
 * Builds Docker images for each supported runtime. Base images are built from
 * the multi-stage `docker/Dockerfile`. Custom images layer user-specified
 * packages on top of the base images.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Docker from "dockerode";
import { RuntimeRegistry } from "../runtime";
import type { Isol8Config } from "../types";
import { logger } from "../utils/logger";

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

/** Label keys for image metadata */
const LABELS = {
  dockerHash: "org.isol8.build.hash",
  depsHash: "org.isol8.deps.hash",
} as const;

/** Files in docker directory that affect the build */
const DOCKER_BUILD_FILES = ["Dockerfile", "proxy.sh", "proxy-handler.sh"];

/**
 * Computes a SHA256 hash of all relevant files in the docker directory.
 * This is used to detect when the Dockerfile or proxy scripts have changed.
 */
function computeDockerDirHash(): string {
  const hash = createHash("sha256");

  // Sort files for consistent hashing
  const files = [...DOCKER_BUILD_FILES].sort();

  for (const file of files) {
    const filePath = join(DOCKERFILE_DIR, file);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath);
      hash.update(file);
      hash.update(content);
    }
  }

  return hash.digest("hex");
}

/**
 * Computes a SHA256 hash of the dependency list for a specific runtime.
 */
function computeDepsHash(runtime: string, packages: string[]): string {
  const hash = createHash("sha256");
  hash.update(runtime);
  // Sort packages for consistent hashing
  for (const pkg of [...packages].sort()) {
    hash.update(pkg);
  }
  return hash.digest("hex");
}

/**
 * Normalize package lists for stable tags/cache hits.
 * - trims whitespace
 * - removes empty entries
 * - de-duplicates
 * - sorts lexicographically
 */
export function normalizePackages(packages: string[]): string[] {
  return [...new Set(packages.map((pkg) => pkg.trim()).filter(Boolean))].sort();
}

/**
 * Returns deterministic custom image tag for a runtime + package set.
 * Uses a short deps hash suffix to avoid tag collisions across different
 * dependency sets for the same runtime.
 */
export function getCustomImageTag(runtime: string, packages: string[]): string {
  const normalizedPackages = normalizePackages(packages);
  const depsHash = computeDepsHash(runtime, normalizedPackages);
  const shortHash = depsHash.slice(0, 12);
  return `isol8:${runtime}-custom-${shortHash}`;
}

/**
 * Gets the labels from an existing Docker image.
 * Returns null if the image doesn't exist.
 */
async function getImageLabels(
  docker: Docker,
  imageName: string
): Promise<Record<string, string> | null> {
  try {
    const image = docker.getImage(imageName);
    const inspect = await image.inspect();
    return (inspect.Config?.Labels as Record<string, string>) ?? {};
  } catch {
    return null;
  }
}

/**
 * Removes a Docker image by ID.
 * Silently fails if the image doesn't exist or can't be removed.
 */
async function removeImage(docker: Docker, imageId: string): Promise<void> {
  try {
    const image = docker.getImage(imageId);
    await image.remove();
    logger.debug(`[ImageBuilder] Removed old image: ${imageId.slice(0, 12)}`);
  } catch (err) {
    // Image might be in use or already removed - log but don't fail
    logger.debug(`[ImageBuilder] Could not remove image ${imageId.slice(0, 12)}: ${err}`);
  }
}

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
 * Uses smart build logic: computes a hash of the docker directory contents
 * and skips builds if the image already exists with matching hash.
 * Cleans up dangling images after rebuilding.
 *
 * @param docker - Dockerode instance.
 * @param onProgress - Optional callback for build progress updates.
 * @param force - If true, always rebuild even if image is up to date.
 */
export async function buildBaseImages(
  docker: Docker,
  onProgress?: ProgressCallback,
  force = false,
  onlyRuntimes?: string[]
): Promise<void> {
  const allRuntimes = RuntimeRegistry.list();
  const runtimes = onlyRuntimes
    ? allRuntimes.filter((r) => onlyRuntimes.includes(r.name))
    : allRuntimes;
  const dockerHash = computeDockerDirHash();
  logger.debug(`[ImageBuilder] Docker directory hash: ${dockerHash.slice(0, 16)}...`);

  for (const adapter of runtimes) {
    const target = adapter.name;
    const imageName = adapter.image;

    // Check if we can skip the build
    if (!force) {
      const labels = await getImageLabels(docker, imageName);
      if (labels && labels[LABELS.dockerHash] === dockerHash) {
        logger.debug(`[ImageBuilder] Base image ${target} is up to date, skipping build`);
        onProgress?.({ runtime: target, status: "done", message: "Up to date" });
        continue;
      }
    }

    // Get the old image ID before building (for cleanup)
    let oldImageId: string | null = null;
    try {
      const oldImage = await docker.getImage(imageName).inspect();
      oldImageId = oldImage.Id;
      logger.debug(`[ImageBuilder] Existing image ${target} ID: ${oldImageId.slice(0, 12)}`);
    } catch {
      // Image doesn't exist yet
      logger.debug(`[ImageBuilder] No existing image for ${target}`);
    }

    onProgress?.({ runtime: target, status: "building" });

    try {
      const stream = await docker.buildImage(
        { context: DOCKERFILE_DIR, src: DOCKER_BUILD_FILES },
        {
          t: imageName,
          target,
          dockerfile: "Dockerfile",
          labels: {
            [LABELS.dockerHash]: dockerHash,
          },
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

      // Clean up the old image if it existed and was replaced
      if (oldImageId) {
        await removeImage(docker, oldImageId);
      }

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
 * Uses smart build logic: computes a hash of the dependency list and
 * skips builds if the image already exists with matching hash.
 * Cleans up dangling images after rebuilding.
 *
 * @param docker - Dockerode instance.
 * @param config - Resolved isol8 configuration.
 * @param onProgress - Optional callback for build progress updates.
 * @param force - If true, always rebuild even if image is up to date.
 */
export async function buildCustomImages(
  docker: Docker,
  config: Isol8Config,
  onProgress?: ProgressCallback,
  force = false
): Promise<void> {
  const deps = config.dependencies;

  const python = deps.python ? normalizePackages(deps.python) : [];
  const node = deps.node ? normalizePackages(deps.node) : [];
  const bun = deps.bun ? normalizePackages(deps.bun) : [];
  const deno = deps.deno ? normalizePackages(deps.deno) : [];
  const bash = deps.bash ? normalizePackages(deps.bash) : [];

  if (python.length) {
    await buildCustomImage(docker, "python", python, onProgress, force);
  }
  if (node.length) {
    await buildCustomImage(docker, "node", node, onProgress, force);
  }
  if (bun.length) {
    await buildCustomImage(docker, "bun", bun, onProgress, force);
  }
  if (deno.length) {
    await buildCustomImage(docker, "deno", deno, onProgress, force);
  }
  if (bash.length) {
    await buildCustomImage(docker, "bash", bash, onProgress, force);
  }
}

export async function buildCustomImage(
  docker: Docker,
  runtime: import("../types").Runtime | string,
  packages: string[],
  onProgress?: ProgressCallback,
  force = false
): Promise<void> {
  const normalizedPackages = normalizePackages(packages);
  const tag = getCustomImageTag(runtime, normalizedPackages);
  const depsHash = computeDepsHash(runtime, normalizedPackages);
  logger.debug(`[ImageBuilder] ${runtime} custom deps hash: ${depsHash.slice(0, 16)}...`);

  // Check if we can skip the build
  if (!force) {
    const labels = await getImageLabels(docker, tag);
    if (labels && labels[LABELS.depsHash] === depsHash) {
      logger.debug(`[ImageBuilder] Custom image ${runtime} is up to date, skipping build`);
      onProgress?.({ runtime, status: "done", message: "Up to date" });
      return;
    }
  }

  // Get the old image ID before building (for cleanup)
  let oldImageId: string | null = null;
  try {
    const oldImage = await docker.getImage(tag).inspect();
    oldImageId = oldImage.Id;
    logger.debug(`[ImageBuilder] Existing custom image ${runtime} ID: ${oldImageId.slice(0, 12)}`);
  } catch {
    // Image doesn't exist yet
    logger.debug(`[ImageBuilder] No existing custom image for ${runtime}`);
  }

  onProgress?.({
    runtime,
    status: "building",
    message: `Custom: ${normalizedPackages.join(", ")}`,
  });

  // Generate a Dockerfile that extends the base image
  let installCmd: string;
  switch (runtime) {
    case "python":
      installCmd = `RUN pip install --no-cache-dir ${normalizedPackages.join(" ")}`;
      break;
    case "node":
      installCmd = `RUN npm install -g ${normalizedPackages.join(" ")}`;
      break;
    case "bun":
      installCmd = `RUN bun install -g ${normalizedPackages.join(" ")}`;
      break;
    case "deno":
      // Deno uses URL imports, but we can pre-cache
      installCmd = normalizedPackages.map((p) => `RUN deno cache ${p}`).join("\n");
      break;
    case "bash":
      installCmd = `RUN apk add --no-cache ${normalizedPackages.join(" ")}`;
      break;
    default:
      throw new Error(`Unknown runtime: ${runtime}`);
  }

  const dockerfileContent = `FROM isol8:${runtime}\n${installCmd}\n`;

  // Build using dockerode with an inline tar containing just the Dockerfile
  const { createTarBuffer, validatePackageName } = await import("./utils");
  const { Readable } = await import("node:stream");

  // Validate all packages before building
  normalizedPackages.forEach(validatePackageName);

  const tarBuffer = createTarBuffer("Dockerfile", dockerfileContent);

  const stream = await docker.buildImage(Readable.from(tarBuffer), {
    t: tag,
    dockerfile: "Dockerfile",
    labels: {
      [LABELS.depsHash]: depsHash,
    },
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

  // Clean up the old image if it existed and was replaced
  if (oldImageId) {
    await removeImage(docker, oldImageId);
  }

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
    await buildBaseImages(docker, onProgress, false, missing);
  }
}
