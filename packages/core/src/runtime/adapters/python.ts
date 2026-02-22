/** Python runtime adapter — uses `python3` from the `isol8:python` image. */
import type { RuntimeAdapter } from "../adapter";

export const PythonAdapter: RuntimeAdapter = {
  name: "python",
  image: "isol8:python",

  getCommand(code: string, filePath?: string): string[] {
    if (filePath) {
      return ["python3", filePath];
    }
    return ["python3", "-c", code];
  },

  getFileExtension(): string {
    return ".py";
  },
};
