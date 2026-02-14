/**
 * Deno runtime adapter — uses `deno` from the `isol8:deno` image.
 *
 * Uses `.mts` extension to avoid collision with Bun's `.ts`.
 * Permissions are scoped: read/write to /sandbox, env access, and
 * optionally net access (controlled by the engine's network mode).
 */
import type { RuntimeAdapter } from "../adapter";

export const DenoAdapter: RuntimeAdapter = {
  name: "deno",
  image: "isol8:deno",

  getCommand(_code: string, filePath?: string): string[] {
    if (!filePath) {
      throw new Error("Deno adapter requires a file path — inline code is not supported.");
    }
    return [
      "deno",
      "run",
      "--allow-read=/sandbox,/tmp",
      "--allow-write=/sandbox,/tmp",
      "--allow-env",
      "--allow-net",
      filePath,
    ];
  },

  getFileExtension(): string {
    return ".mts";
  },
};
