#!/usr/bin/env python3
"""Parse benchmark output and format as table."""

import sys

with open("bench-output.log", "r") as f:
    content = f.read()

lines = content.split("\n")
in_table = False
results = []

for line in lines:
    if "Runtime" in line and "Min" in line:
        in_table = True
        continue
    if in_table and line.strip() and "|" in line:
        parts = [p.strip() for p in line.split("|") if p.strip()]
        if len(parts) >= 4 and parts[0] != "Runtime":
            results.append(parts)
    elif in_table and not line.strip():
        break

if results:
    print("\n| Runtime | Min   | Max   | Avg   |")
    print("|---------|-------|-------|-------|")
    for r in results:
        print(f"| {r[0]:7} | {r[1]:5} | {r[2]:5} | {r[3]:5} |")
    print(f"\nTotal: {len(results)} runtimes tested")
else:
    print("No benchmark results found")
