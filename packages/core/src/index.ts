/**
 * @module @isol8/core
 *
 * Public API for the isol8 secure code execution engine.
 * Import from `"@isol8/core"` to access the engine, client, config, runtime registry.
 */

// ─── Core Types ───

export type { RemoteIsol8Options } from "./client/remote";
// ─── Client ───
export { RemoteIsol8 } from "./client/remote";
// ─── Config ───
export { loadConfig } from "./config";
export type { DockerIsol8Options } from "./engine/docker";
// ─── Engine ───
export { DockerIsol8 } from "./engine/docker";
export { buildBaseImages, buildCustomImages } from "./engine/image-builder";
// ─── Runtime ───
export {
  BunAdapter,
  bashAdapter,
  DenoAdapter,
  NodeAdapter,
  PythonAdapter,
  RuntimeRegistry,
} from "./runtime";
export type { RuntimeAdapter } from "./runtime/adapter";
// ─── Types ───
export type {
  ExecutionRequest,
  ExecutionResult,
  Isol8Config,
  Isol8Engine,
  Isol8Mode,
  Isol8Options,
  NetworkFilterConfig,
  NetworkMode,
  RemoteCodePolicy,
  Runtime,
  StreamEvent,
} from "./types";
// ─── Utils ───
export { logger } from "./utils/logger";
// ─── Version ───
export { VERSION } from "./version";
