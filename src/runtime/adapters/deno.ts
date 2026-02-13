/**
 * Deno runtime adapter — uses `deno` from the `isol8:deno` image.
 *
 * Note: Deno lacks a clean `-e` flag for inline code, so inline execution
 * uses a shell pipe to write the code to a temp file before running it.
 * Also maps to `.ts` — conflicts with Bun (last registered wins in the extension map).
 */
import type { RuntimeAdapter } from "../adapter";

export const DenoAdapter: RuntimeAdapter = {
  name: "deno",
  image: "isol8:deno",

  getCommand(code: string, filePath?: string): string[] {
    if (filePath) {
      return ["deno", "run", "--allow-all", filePath];
    }
    // Deno doesn't have a clean -e flag, write to tmp file via shell
    return [
      "sh",
      "-c",
      `echo '${code.replace(/'/g, "'\\''")}' > /tmp/_exec.ts && deno run --allow-all /tmp/_exec.ts`,
    ];
  },

  getFileExtension(): string {
    return ".ts";
  },
};
