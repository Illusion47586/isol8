import { describe, expect, test } from "bun:test";
import {
  createTarBuffer,
  extractFromTar,
  maskSecrets,
  parseMemoryLimit,
  truncateOutput,
} from "../../src/engine/utils";

describe("parseMemoryLimit", () => {
  test("parses megabytes", () => {
    expect(parseMemoryLimit("512m")).toBe(512 * 1024 * 1024);
  });

  test("parses gigabytes", () => {
    expect(parseMemoryLimit("1g")).toBe(1024 * 1024 * 1024);
  });

  test("parses kilobytes", () => {
    expect(parseMemoryLimit("256k")).toBe(256 * 1024);
  });

  test("parses plain bytes", () => {
    expect(parseMemoryLimit("1024")).toBe(1024);
  });

  test("parses with 'b' suffix", () => {
    expect(parseMemoryLimit("512mb")).toBe(512 * 1024 * 1024);
  });

  test("throws on invalid format", () => {
    expect(() => parseMemoryLimit("invalid")).toThrow("Invalid memory limit format");
  });
});

describe("truncateOutput", () => {
  test("returns original if under limit", () => {
    const { text, truncated } = truncateOutput("hello", 100);
    expect(text).toBe("hello");
    expect(truncated).toBe(false);
  });

  test("truncates if over limit", () => {
    const long = "a".repeat(200);
    const { text, truncated } = truncateOutput(long, 50);
    expect(truncated).toBe(true);
    expect(text).toContain("OUTPUT TRUNCATED");
    expect(text.length).toBeLessThan(long.length);
  });
});

describe("maskSecrets", () => {
  test("masks secret values", () => {
    const result = maskSecrets("my key is sk-123456", { API_KEY: "sk-123456" });
    expect(result).toBe("my key is ***");
  });

  test("masks multiple secrets", () => {
    const result = maskSecrets("user=admin pass=secret123", {
      USER: "admin",
      PASS: "secret123",
    });
    expect(result).toBe("user=*** pass=***");
  });

  test("ignores empty secret values", () => {
    const result = maskSecrets("hello world", { EMPTY: "" });
    expect(result).toBe("hello world");
  });
});

describe("tar utilities", () => {
  test("creates and extracts tar archive", () => {
    const content = "print('hello world')";
    const tar = createTarBuffer("sandbox/main.py", content);
    const extracted = extractFromTar(tar, "sandbox/main.py");
    expect(extracted.toString("utf-8")).toBe(content);
  });

  test("handles binary content", () => {
    const content = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    const tar = createTarBuffer("data.bin", content);
    const extracted = extractFromTar(tar, "data.bin");
    expect(Buffer.compare(extracted, content)).toBe(0);
  });

  test("throws if file not found in tar", () => {
    const tar = createTarBuffer("existing.txt", "data");
    expect(() => extractFromTar(tar, "missing.txt")).toThrow("not found in tar archive");
  });
});
