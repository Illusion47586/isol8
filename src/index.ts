/**
 * @module isol8
 *
 * Public API for the isol8 secure code execution engine.
 * Import from `"isol8"` to access the engine, client, config, runtime registry, and server.
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
// ─── Server ───
export { createServer } from "./server/index";
export type {
  ExecutionRequest,
  ExecutionResult,
  Isol8Config,
  Isol8Engine,
  Isol8Mode,
  Isol8Options,
  NetworkFilterConfig,
  NetworkMode,
  Runtime,
  StreamEvent,
} from "./types";
// ─── Version ───
export { VERSION } from "./version";
