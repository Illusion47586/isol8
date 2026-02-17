#!/usr/bin/env python3
"""Parse benchmark output and write to summary markdown file."""

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

# Write summary to markdown file
with open("bench-summary.md", "w") as f:
    f.write("\n## Performance Benchmarks\n\n")
    f.write("| Runtime | Min | Max | Avg |\n")
    f.write("|--------|-----|-----|-----|\n")
    for r in results:
        f.write(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} |\n")
    f.write(f"\n**Total runtimes tested:** {len(results)}\n")

# Also print to stdout
if results:
    print("\n| Runtime | Min   | Max   | Avg   |")
    print("|---------|-------|-------|-------|")
    for r in results:
        print(f"| {r[0]:7} | {r[1]:5} | {r[2]:5} | {r[3]:5} |")
    print(f"\nTotal: {len(results)} runtimes tested")
