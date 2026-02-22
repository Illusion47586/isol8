#!/usr/bin/env bun
/**
 * Sync version across all packages in the monorepo.
 * Usage: bun run scripts/sync-versions.ts <version>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = dirname(import.meta.dir);
const version = process.argv[2];

if (!version) {
  console.error("Usage: bun run scripts/sync-versions.ts <version>");
  process.exit(1);
}

const packages = [
  "packages/core/package.json",
  "apps/cli/package.json",
  "apps/server/package.json",
  "apps/docs/package.json",
];

console.log(`📦 Syncing version ${version} across all packages...`);

for (const pkgPath of packages) {
  const fullPath = join(root, pkgPath);
  const pkg = JSON.parse(readFileSync(fullPath, "utf-8"));
  pkg.version = version;
  writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`   ✓ ${pkg.name} → ${version}`);
}

// Also update root package.json
const rootPkgPath = join(root, "package.json");
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf-8"));
rootPkg.version = version;
writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + "\n");
console.log(`   ✓ isol8 (root) → ${version}`);

console.log("✅ All packages synced!");
