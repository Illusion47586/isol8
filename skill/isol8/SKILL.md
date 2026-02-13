---
name: isol8
description: Securely execute untrusted Python, Node.js, Bun, Deno, and Bash code in sandboxed Docker containers.
---

# Isol8 Skill

Isol8 is a secure execution engine for running untrusted code. Use this skill when you need to execute code snippets, scripts, or system commands in a safe, isolated environment. It supports multiple runtimes, persistent state, file I/O, and network control.

## Key Capabilities

- **Runtimes**: Python (3.x), Node.js (LTS), Bun, Deno, Bash.
- **Isolation**: Docker containers with no network access by default.
- **Resources**: Configurable memory (default 512MB) and CPU limits.
- **State**: Ephemeral (one-off) or Persistent (session-based) execution.
- **Dependencies**: Pre-installed packages or custom dependency injection.

## CLI Usage

The primary interface is the `isol8` CLI.

### 1. Execute Code Structure

```bash
isol8 run [options] [file]
```

| Option | Description | Example |
| :--- | :--- | :--- |
| `-e, --eval <code>` | Execute inline code string | `-e "print(1+1)"` |
| `-r, --runtime <name>` | Force runtime (`python`, `node`, `bun`, `deno`, `bash`) | `--runtime python` |
| `--persistent` | Use a persistent container (preserves state) | `--persistent` |
| `--net <mode>` | Network mode (`none`, `host`, `filtered`) | `--net filtered` |
| `--allow <regex>` | Whitelist regex for `filtered` network mode | `--allow "google.com"` |
| `--out <file>` | Write stdout to a file | `--out result.txt` |
| `--timeout <ms>` | Execution timeout in milliseconds | `--timeout 5000` |
| `--memory <limit>` | Memory limit | `--memory 1g` |

### 2. Examples by Runtime

#### Python
```bash
# Inline execution
isol8 run -e "print('Hello')" --runtime python

# Run a file
isol8 run ./script.py
```

#### Bash (System Commands)
```bash
# Run a shell command
isol8 run -e "grep -r 'TODO' ." --runtime bash

# Install packages (requires custom image setup or persistent mode + apk)
# Note: Default images are Alpine-based.
```

#### JavaScript / TypeScript
```bash
isol8 run -e "console.log('JS')" --runtime node
isol8 run -e "console.log('TS')" --runtime bun
```

### 3. Persistent Sessions
Use `--persistent` to keep variables and files between runs.

```bash
# Run 1: Set a variable (in a file or stateful runtime)
isol8 run --persistent -e "echo 'secret' > /tmp/data" --runtime bash

# Run 2: Read it back
isol8 run --persistent -e "cat /tmp/data" --runtime bash
```

### 4. File I/O
To compute on data, pipe it in or use file arguments.

**Piping Input:**
```bash
cat data.csv | isol8 run -e "import sys; print(len(sys.stdin.readlines()))" --runtime python
```

**Writing Output:**
```bash
isol8 run script.py --out results.json
```

### 5. Network Filtering
By default, network is disabled. To allow specific access:
```bash
isol8 run --net filtered --allow "^api\.openai\.com$" script.py
```

## Setup & Dependencies

To install custom dependencies, use `isol8 setup` or edit `isol8.config.json`.

```bash
# Add Python packages
isol8 setup --python "numpy,pandas,scipy"

# Add Node/Bun packages
isol8 setup --bun "zod,hono"

# Add System packages (Alpine apk) for Bash
isol8 setup --bash "curl,git,jq"
```

This rebuilds the Docker images with your packages baked in.

## Troubleshooting

- **"Docker not running"**: Run `isol8 setup` to check status.
- **Timeouts**: Increase `--timeout`.
- **OOM Killed**: Increase `--memory`.
