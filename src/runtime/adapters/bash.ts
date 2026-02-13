import type { RuntimeAdapter } from "../adapter";

export const bashAdapter: RuntimeAdapter = {
  name: "bash",
  image: "isol8:bash",
  getCommand(code: string, filePath?: string): string[] {
    if (filePath) {
      return ["bash", filePath];
    }
    return ["bash", "-c", code];
  },
  getFileExtension() {
    return ".sh";
  },
};
