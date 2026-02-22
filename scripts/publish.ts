#!/usr/bin/env bun
/**
 * Publish script for isol8 monorepo.
 * Syncs versions, builds all packages, and links or publishes to npm.
 *
 * Usage:
 *   bun run publish -- --link         # Local link with bun link
 *   bun run publish -- --dry-run      # Dry run (simulate without publishing)
 *   bun run publish -- 0.13.0        # Publish to npm (alpha tag)
 *   bun run publish -- 0.13.0 beta   # Publish to npm (specific tag)
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = dirname(import.meta.dir);

const args = process.argv.slice(2);

// Check for help flag early
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Publish script for isol8 monorepo.

Usage:
  bun run publish -- [options]         # Publish or link packages

Options:
  --link, -l    Link packages locally with bun link (for local testing)
  --dry-run, -n Simulate without actually publishing/linking
  [version]      Version to publish (default: current version)
  [tag]          npm tag (default: alpha)

Examples:
  bun run publish -- --link              # Link packages locally
  bun run publish -- --dry-run           # Simulate publish
  bun run publish -- 0.13.0             # Publish 0.13.0 to alpha
  bun run publish -- 0.14.0-beta.1 beta # Publish beta to beta tag
`);
  process.exit(0);
}

const dryRun = args.includes("--dry-run") || args.includes("-n");
const linkMode = args.includes("--link") || args.includes("-l");

// Filter out flags for version/tag parsing
const filteredArgs = args.filter((a) => !a.startsWith("-"));
let version = filteredArgs[0];
const tag = filteredArgs[1] || "alpha";

function run(cmd: string, options: { cwd?: string; silent?: boolean } = {}) {
  if (!options.silent) {
    console.log(`$ ${cmd}`);
  }
  if (!dryRun) {
    execSync(cmd, {
      stdio: "inherit",
      cwd: options.cwd || root,
    });
  }
}

function log(msg: string) {
  console.log(msg);
}

function getCurrentVersion(): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
  return pkg.version;
}

function isValidVersion(v: string): boolean {
  return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(v);
}

/**
 * Fix workspace dependencies in package.json for npm publishing
 * Replaces workspace:* with the actual version
 */
function fixWorkspaceDeps(pkgPath: string): void {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

  // Get root version
  const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
  const rootVersion = rootPkg.version;

  // Fix dependencies
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  for (const [dep, ver] of Object.entries(allDeps)) {
    if (ver === "workspace:*") {
      // For workspace packages, use root version with ^ prefix
      const newVer = `^${rootVersion}`;

      if (pkg.dependencies?.[dep]) {
        pkg.dependencies[dep] = newVer;
      }
      if (pkg.devDependencies?.[dep]) {
        pkg.devDependencies[dep] = newVer;
      }

      console.log(`   Fixed ${dep}: workspace:* -> ${newVer}`);
    }
  }

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

if (!version) {
  version = getCurrentVersion();
  log(`No version provided, using current version: ${version}`);
} else if (version === "latest") {
  version = getCurrentVersion();
  log(`Publishing latest version: ${version}`);
} else if (isValidVersion(version)) {
  log(`Publishing version: ${version}`);
} else {
  console.error(`Error: Invalid version "${version}". Expected a valid semver (e.g., 0.13.0)`);
  console.error("Use --help for usage information");
  process.exit(1);
}

if (linkMode) {
  log("Linking packages locally with bun link");
} else {
  log(`Publishing to npm with tag: ${tag}`);
}

if (dryRun) {
  log("🔍 DRY RUN MODE - No actual changes will be made");
}
log("");

log("📦 Step 1: Syncing versions...");
run(`bun run scripts/sync-versions.ts ${version}`);
if (dryRun) {
  log("   [DRY RUN] Versions synced in package.json files");
}

log("");
log("🔨 Step 2: Building all packages...");
run("bun run build");
if (dryRun) {
  log("   [DRY RUN] All packages built to dist/");
}

log("");
log("📝 Step 3: Fixing workspace dependencies for npm...");
log("   Fixing apps/cli/package.json...");
fixWorkspaceDeps(join(root, "apps/cli/package.json"));
if (dryRun) {
  log("   [DRY RUN] Would fix workspace deps in cli");
}

log("");

if (linkMode) {
  log("Step 4: Linking @isol8/core...");
  run("bun link", { cwd: join(root, "packages/core"), silent: true });
  run("cd packages/core && bun link", { cwd: root });
  if (dryRun) {
    log("   [DRY RUN] Would run: bun link in @isol8/core");
  }

  log("");
  log("Step 5: Linking @isol8/cli...");
  run("cd apps/cli && bun link", { cwd: root });
  if (dryRun) {
    log("   [DRY RUN] Would run: bun link in @isol8/cli");
  }

  log("");
  if (dryRun) {
    log("✅ Dry run complete - Would have linked @isol8/core and @isol8/cli");
  } else {
    log("✅ Linked @isol8/core and @isol8/cli locally");
    log("");
    log("To use in another project:");
    log("  bun link @isol8/core");
    log("  bun link @isol8/cli");
  }
} else {
  log("Step 4: Publishing @isol8/core to npm...");
  run(`npm publish --access public --tag ${tag} --force`, {
    cwd: join(root, "packages/core"),
  });
  if (dryRun) {
    log("   [DRY RUN] Would publish @isol8/core to npm");
  }

  log("");
  log("Step 5: Publishing @isol8/cli to npm...");
  run(`npm publish --access public --tag ${tag} --force`, {
    cwd: join(root, "apps/cli"),
  });
  if (dryRun) {
    log("   [DRY RUN] Would publish @isol8/cli to npm");
  }

  log("");
  if (dryRun) {
    log(`✅ Dry run complete - Would have published v${version} to ${tag} tag`);
  } else {
    log(`✅ Published @isol8/core and @isol8/cli v${version} to ${tag} tag`);
  }
}
