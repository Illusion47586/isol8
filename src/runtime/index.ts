/**
 * @module runtime
 *
 * Barrel module that registers all built-in runtime adapters and re-exports
 * the public API. Importing this module has the side effect of populating
 * the {@link RuntimeRegistry} with Python, Node, Bun, and Deno adapters.
 */

import { RuntimeRegistry } from "./adapter";
import { bashAdapter } from "./adapters/bash";
import { BunAdapter } from "./adapters/bun";
import { DenoAdapter } from "./adapters/deno";
import { NodeAdapter } from "./adapters/node";
import { PythonAdapter } from "./adapters/python";

// Register all built-in adapters (order matters for extension collisions)
RuntimeRegistry.register(PythonAdapter);
RuntimeRegistry.register(NodeAdapter);
RuntimeRegistry.register(BunAdapter); // Bun wins for .ts
RuntimeRegistry.register(bashAdapter);
RuntimeRegistry.register(DenoAdapter); // Deno uses .mts to avoid extension collision

export type { RuntimeAdapter } from "./adapter";
export { RuntimeRegistry } from "./adapter";
export { bashAdapter } from "./adapters/bash";
export { BunAdapter } from "./adapters/bun";
export { DenoAdapter } from "./adapters/deno";
export { NodeAdapter } from "./adapters/node";
export { PythonAdapter } from "./adapters/python";
