/** Bun runtime adapter — uses `bun` from the `isol8:bun` image. Maps to `.ts` extension. */
import type { RuntimeAdapter } from "../adapter";

export const BunAdapter: RuntimeAdapter = {
  name: "bun",
  image: "isol8:bun",

  getCommand(code: string, filePath?: string): string[] {
    if (filePath) {
      return ["bun", "run", filePath];
    }
    return ["bun", "-e", code];
  },

  getFileExtension(): string {
    return ".ts";
  },
};
