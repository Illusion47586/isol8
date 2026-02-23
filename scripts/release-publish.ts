#!/usr/bin/env bun

import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("Usage: bun run scripts/release-publish.ts <version>");
  process.exit(1);
}

const cliPkgPath = "apps/cli/package.json";
const backupPath = join(tmpdir(), `isol8-cli-package-${Date.now()}.json`);

const run = async (cmd: string, cwd?: string): Promise<void> => {
  const proc = Bun.spawn(cmd.split(" "), {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${cmd}`);
  }
};

const restoreCliPackage = () => {
  cpSync(backupPath, cliPkgPath);
};

try {
  cpSync(cliPkgPath, backupPath);

  const cliPkg = JSON.parse(readFileSync(cliPkgPath, "utf8"));
  cliPkg.dependencies = cliPkg.dependencies ?? {};
  cliPkg.dependencies["@isol8/core"] = `^${version}`;
  writeFileSync(cliPkgPath, `${JSON.stringify(cliPkg, null, 2)}\n`);

  await run("npm publish --provenance --access public", "packages/core");
  await run("npm publish --provenance --access public", "apps/cli");
} finally {
  restoreCliPackage();
}
