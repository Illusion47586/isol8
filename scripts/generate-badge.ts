#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const summaryPath = join(process.cwd(), "coverage", "summary.json");
const outputPath = join(process.cwd(), "coverage", "coverage-badge.svg");

const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
const pct = summary.lines.pct.toFixed(1);

const color = pct >= 80 ? "brightgreen" : pct >= 50 ? "yellow" : "red";

const badgeUrl = `https://img.shields.io/badge/coverage-${pct}%25-${color}`;

console.log(`Fetching badge: ${badgeUrl}`);

const response = await fetch(badgeUrl);
const svg = await response.text();

writeFileSync(outputPath, svg);
console.log(`Badge saved to ${outputPath}`);
console.log(`Coverage: ${pct}%`);
