#!/usr/bin/env bun

/**
 * Publish releasable workspace packages using Changesets.
 *
 * - Local maintainers: run without args to build + publish
 * - CI: pass --ci to skip interactive prompts and use CI env
 */

const args = new Set(process.argv.slice(2));
const isCI = args.has("--ci");

const run = async (cmd: string, cwd?: string): Promise<void> => {
  const proc = Bun.spawn(cmd.split(" "), {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: process.env,
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${cmd}`);
  }
};

await run("bun run build");
await run("bun run build:all", "apps/server");
await run("changeset publish");

if (!isCI) {
  console.log("Published packages via Changesets.");
}
