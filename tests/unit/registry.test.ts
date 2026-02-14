import { describe, expect, test } from "bun:test";
import { RuntimeRegistry } from "../../src/runtime";

// Import to register adapters
import "../../src/runtime";

describe("RuntimeRegistry", () => {
  test("gets adapter by name", () => {
    const adapter = RuntimeRegistry.get("python");
    expect(adapter.name).toBe("python");
    expect(adapter.image).toBe("isol8:python");
  });

  test("throws on unknown runtime", () => {
    expect(() => RuntimeRegistry.get("rust")).toThrow("Unknown runtime");
  });

  test("detects runtime from filename", () => {
    expect(RuntimeRegistry.detect("script.py").name).toBe("python");
    expect(RuntimeRegistry.detect("app.js").name).toBe("node");
    expect(RuntimeRegistry.detect("main.ts").name).toBe("bun"); // .ts maps to bun (registered before deno)
    expect(RuntimeRegistry.detect("main.mts").name).toBe("deno"); // .mts maps to deno
  });

  test("throws on unknown extension", () => {
    expect(() => RuntimeRegistry.detect("file.xyz")).toThrow("Cannot detect runtime");
  });

  test("lists all registered adapters", () => {
    const adapters = RuntimeRegistry.list();
    const names = adapters.map((a) => a.name);
    expect(names).toContain("python");
    expect(names).toContain("node");
    expect(names).toContain("bun");
    expect(names).toContain("deno");
  });

  test("python adapter generates correct commands", () => {
    const adapter = RuntimeRegistry.get("python");
    expect(adapter.getCommand("print('hi')")).toEqual(["python3", "-c", "print('hi')"]);
    expect(adapter.getCommand("", "/sandbox/main.py")).toEqual(["python3", "/sandbox/main.py"]);
    expect(adapter.getFileExtension()).toBe(".py");
  });

  test("node adapter generates correct commands", () => {
    const adapter = RuntimeRegistry.get("node");
    expect(adapter.getCommand("console.log(1)")).toEqual(["node", "-e", "console.log(1)"]);
    expect(adapter.getCommand("", "/sandbox/app.js")).toEqual(["node", "/sandbox/app.js"]);
    expect(adapter.getFileExtension()).toBe(".js");
  });
});
