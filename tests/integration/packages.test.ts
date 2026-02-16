import { describe, expect, test } from "bun:test";
import { DockerIsol8 } from "../../src/engine/docker";
import { hasDocker } from "./setup";

describe("Integration: Package Installation", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const engine = new DockerIsol8({
    mode: "ephemeral",
    // Must allow network for installing packages
    network: "host",
    readonlyRootFs: false,
    security: { seccomp: "unconfined" },
  });

  // Note: These tests might be slow due to network/install times
  test("Python: installs numpy", async () => {
    const result = await engine.execute({
      code: "import numpy; print(numpy.__version__)",
      runtime: "python",
      installPackages: ["numpy"],
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  }, 120_000);

  test("Node: installs lodash", async () => {
    const result = await engine.execute({
      code: `import _ from 'lodash'; console.log(_.kebabCase('Hello World'));`,
      runtime: "node",
      installPackages: ["lodash"],
      timeoutMs: 60_000,
    });

    // Debug output
    if (result.exitCode !== 0) {
      console.log("Node Stdout:", result.stdout);
      console.log("Node Stderr:", result.stderr);
    }

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-world");
  }, 60_000);

  test("Bash: installs curl", async () => {
    // curl is already in base but let's try something small like 'jq' if not present
    // actually base image is minimal alpine, so let's install 'jq'
    const result = await engine.execute({
      code: `echo '{"a":1}' | jq '.a'`,
      runtime: "bash",
      installPackages: ["jq"],
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("1");
  }, 120_000);

  test("Bun: installs zod (ESM)", async () => {
    const result = await engine.execute({
      code: `import { z } from 'zod'; console.log(z.string().parse('hello bun'))`,
      runtime: "bun",
      installPackages: ["zod"],
      timeoutMs: 60_000,
    });

    if (result.exitCode !== 0) {
      console.log("Bun Stdout:", result.stdout);
      console.log("Bun Stderr:", result.stderr);
    }

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello bun");
  }, 60_000);

  test("Node: installs zod (ESM)", async () => {
    const result = await engine.execute({
      code: `import { z } from 'zod'; console.log(z.string().parse('hello node'))`,
      runtime: "node",
      installPackages: ["zod"],
      timeoutMs: 60_000,
    });

    if (result.exitCode !== 0) {
      console.log("Node ESM Stdout:", result.stdout);
      console.log("Node ESM Stderr:", result.stderr);
    }

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello node");
  }, 60_000);
});
