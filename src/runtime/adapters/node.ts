/** Node.js runtime adapter — uses `node` from the `isol8:node` image. */
import type { RuntimeAdapter } from "../adapter";

export const NodeAdapter: RuntimeAdapter = {
  name: "node",
  image: "isol8:node",

  getCommand(code: string, filePath?: string): string[] {
    if (filePath) {
      return ["node", filePath];
    }
    return ["node", "-e", code];
  },

  getFileExtension(): string {
    return ".js";
  },
};
