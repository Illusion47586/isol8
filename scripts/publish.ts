#!/usr/bin/env bun

/**
 * Publish releasable workspace packages with tarballs.
 * We intentionally pack with Bun so `workspace:*` dependencies are rewritten
 * for publish artifacts without mutating repository package.json files.
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = new Set(process.argv.slice(2));
const isCI = args.has("--ci");
const dryRun = args.has("--dry-run");

const run = async (cmd: string[], cwd?: string): Promise<string> => {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "inherit",
    env: process.env,
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${cmd.join(" ")}`);
  }
  return output;
};

const runMaybe = async (cmd: string[], cwd?: string): Promise<void> => {
  if (dryRun) {
    console.log(`[dry-run] ${cmd.join(" ")}${cwd ? ` (cwd=${cwd})` : ""}`);
    return;
  }
  const output = await run(cmd, cwd);
  if (output.trim()) {
    process.stdout.write(output);
  }
};

const getPackageInfo = async (pkgPath: string): Promise<{ name: string; version: string }> => {
  const pkg = Bun.file(join(pkgPath, "package.json"));
  return pkg.json() as Promise<{ name: string; version: string }>;
};

const hasPublishedVersion = async (name: string, version: string): Promise<boolean> => {
  const proc = Bun.spawn(["npm", "view", `${name}@${version}`, "version", "--json"], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
    env: process.env,
  });
  return (await proc.exited) === 0;
};

const findTarball = (pkgPath: string, name: string, version: string): string => {
  const expected = `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
  const expectedPath = join(pkgPath, expected);
  if (existsSync(expectedPath)) {
    return expectedPath;
  }

  const tarballs = readdirSync(pkgPath).filter((file) => file.endsWith(".tgz"));
  if (tarballs.length === 0) {
    throw new Error(`No tarball produced in ${pkgPath}`);
  }

  // Prefer deterministic expected name; fallback to the newest tgz if Bun naming changes.
  const fallback = tarballs
    .map((file) => ({
      file,
      path: join(pkgPath, file),
      mtime: statSync(join(pkgPath, file)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)[0];

  return fallback.path;
};

await runMaybe(["bun", "run", "build"]);
await runMaybe(["bun", "run", "build:all"], "apps/server");

const publishTargets = ["packages/core", "apps/cli"];
const coreVersion = (await getPackageInfo("packages/core")).version;

for (const pkgPath of publishTargets) {
  const { name, version } = await getPackageInfo(pkgPath);
  const alreadyPublished = await hasPublishedVersion(name, version);

  if (alreadyPublished) {
    console.log(`Skipping ${name}@${version}; already published.`);
    continue;
  }

  const publishOne = async () => {
    console.log(`Packing ${name}@${version}...`);
    await runMaybe(["bun", "pm", "pack"], pkgPath);

    const tarball = findTarball(pkgPath, name, version);
    console.log(`Publishing ${name}@${version} from ${tarball}...`);
    await runMaybe(["npm", "publish", tarball, "--access", "public", "--provenance"]);

    if (!dryRun) {
      rmSync(tarball, { force: true });
    }
  };

  // Ensure published CLI artifacts always contain a concrete @isol8/core semver.
  if (pkgPath === "apps/cli" && !dryRun) {
    const cliPkgPath = join(pkgPath, "package.json");
    const original = readFileSync(cliPkgPath, "utf8");

    try {
      const cliPkg = JSON.parse(original) as {
        dependencies?: Record<string, string>;
      };
      cliPkg.dependencies = cliPkg.dependencies ?? {};
      cliPkg.dependencies["@isol8/core"] = `^${coreVersion}`;
      writeFileSync(cliPkgPath, `${JSON.stringify(cliPkg, null, 2)}\n`);

      await publishOne();
    } finally {
      writeFileSync(cliPkgPath, original);
    }
  } else {
    await publishOne();
  }
}

if (!isCI) {
  console.log(dryRun ? "Dry-run publish complete." : "Publish complete.");
}
