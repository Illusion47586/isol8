/**
 * @module runtime/adapter
 *
 * Defines the {@link RuntimeAdapter} interface and the global {@link RuntimeRegistry}
 * for looking up runtime adapters by name or file extension.
 */

import type { Runtime } from "../types";

/**
 * A runtime adapter provides the container image and command construction
 * for a specific language runtime (Python, Node, Bun, Deno).
 *
 * Adapters are registered in {@link RuntimeRegistry} and looked up by name
 * or by file extension when the runtime is auto-detected.
 */
export interface RuntimeAdapter {
  /** Runtime identifier (e.g. `"python"`, `"node"`). */
  readonly name: Runtime;

  /** Docker image tag for this runtime (e.g. `"isol8:python"`). */
  readonly image: string;

  /**
   * Build the shell command to execute code.
   *
   * @param code - The source code string. Used for inline execution.
   * @param filePath - If provided, the code is read from this file inside the container.
   * @returns Command array (e.g. `["python3", "-c", "print(1)"]`).
   */
  getCommand(code: string, filePath?: string): string[];

  /** Default file extension for this runtime (e.g. `".py"`). */
  getFileExtension(): string;
}

const adapters = new Map<string, RuntimeAdapter>();

const extensionMap = new Map<string, RuntimeAdapter>();

/**
 * Central registry of all available runtime adapters.
 *
 * Built-in adapters (Python, Node, Bun, Deno) are registered automatically
 * when `src/runtime/index.ts` is imported.
 */
export const RuntimeRegistry = {
  /**
   * Register a runtime adapter. Overwrites any existing adapter with the same
   * name or file extension.
   */
  register(adapter: RuntimeAdapter): void {
    adapters.set(adapter.name, adapter);
    extensionMap.set(adapter.getFileExtension(), adapter);
  },

  /**
   * Look up a runtime adapter by name.
   *
   * @param name - Runtime name (e.g. `"python"`).
   * @throws {Error} If no adapter is registered with that name.
   */
  get(name: string): RuntimeAdapter {
    const adapter = adapters.get(name);
    if (!adapter) {
      throw new Error(`Unknown runtime: "${name}". Available: ${[...adapters.keys()].join(", ")}`);
    }
    return adapter;
  },

  /**
   * Auto-detect the runtime from a filename's extension.
   *
   * @param filename - Filename or path (e.g. `"script.py"`, `"app.js"`).
   * @throws {Error} If the extension doesn't match any registered adapter.
   */
  detect(filename: string): RuntimeAdapter {
    const ext = `.${filename.split(".").pop()}`;
    const adapter = extensionMap.get(ext);
    if (!adapter) {
      throw new Error(
        `Cannot detect runtime for "${filename}". Known extensions: ${[...extensionMap.keys()].join(", ")}`
      );
    }
    return adapter;
  },

  /** Returns all registered runtime adapters. */
  list(): RuntimeAdapter[] {
    return [...adapters.values()];
  },
};
