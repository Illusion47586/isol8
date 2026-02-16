#!/usr/bin/env bun

// Simple LCOV parser
async function parseLcov(path: string) {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {
      lines: { total: 0, hit: 0, pct: 0 },
      functions: { total: 0, hit: 0, pct: 0 },
      branches: { total: 0, hit: 0, pct: 0 },
    };
  }
  const content = await file.text();
  const lines = content.split("\n");

  let totalLines = 0;
  let hitLines = 0;
  let totalFunctions = 0;
  let hitFunctions = 0;
  let totalBranches = 0;
  let hitBranches = 0;

  for (const line of lines) {
    if (line.startsWith("DA:")) {
      totalLines++;
      // DA:line,hits
      const val = line.substring(3).split(",")[1];
      if (val && Number.parseInt(val, 10) > 0) {
        hitLines++;
      }
    } else if (line.startsWith("FN:")) {
      totalFunctions++;
    } else if (line.startsWith("FNDA:")) {
      // FNDA:hits,name
      const val = line.substring(5).split(",")[0];
      if (val && Number.parseInt(val, 10) > 0) {
        hitFunctions++;
      }
    } else if (line.startsWith("BRDA:")) {
      totalBranches++;
      // BRDA:line,block,branch,hits
      const val = line.substring(5).split(",")[3];
      if (val && val !== "-" && Number.parseInt(val, 10) > 0) {
        hitBranches++;
      }
    }
  }

  return {
    lines: {
      total: totalLines,
      hit: hitLines,
      pct: totalLines ? (hitLines / totalLines) * 100 : 0,
    },
    functions: {
      total: totalFunctions,
      hit: hitFunctions,
      pct: totalFunctions ? (hitFunctions / totalFunctions) * 100 : 0,
    },
    branches: {
      total: totalBranches,
      hit: hitBranches,
      pct: totalBranches ? (hitBranches / totalBranches) * 100 : 0,
    },
  };
}

const input = process.argv[2] || "coverage/lcov.info";
const output = process.argv[3] || "coverage/summary.json";

const current = await parseLcov(input);
// Write to summary file
await Bun.write(output, JSON.stringify(current, null, 2));

console.log(JSON.stringify(current));
