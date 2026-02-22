import { describe, expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { DockerIsol8 } from "../../src/engine/docker";
import { hasDocker } from "./setup";

describe("Integration: Seccomp", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("Strict mode blocks dangerous syscalls (mount)", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      security: { seccomp: "strict" },
    });

    const result = await engine.execute({
      // Python's os.mount is not available on Linux, we can use ctypes or just try something simpler
      // Actually simpler: unshare(CLONE_NEWNS) is often blocked.
      // Or we can try to use a tool that calls a blocked syscall.
      // Python:
      // import ctypes
      // libc = ctypes.CDLL(None)
      // libc.mount(...)
      code: `
import ctypes
import os

# Try to release a mount point (umount2), usually blocked
# syscall numbers vary by arch, but calling via libc is easier
try:
    libc = ctypes.CDLL("libc.so.6")
    # mount signature: source, target, filesystemtype, mountflags, data
    # We just want to see EPERM
    ret = libc.mount(b"none", b"/tmp", b"tmpfs", 0, 0)
    if ret == 0:
        print("success")
    else:
        errno = ctypes.get_errno()
        print(f"failed: {errno}")
except Exception as e:
    print(f"error: {e}")
      `,
      runtime: "python",
    });

    // 1 = EPERM on Linux usually
    // Strict profile returns EPERM (1) for blocked calls
    expect(result.stdout).toContain("failed");
  }, 30_000);

  test("Custom profile can block specific syscalls", async () => {
    // Create a custom profile that blocks 'mkdir'
    // We'll write to a temp location
    const tempProfilePath = "/tmp/seccomp-block-mkdir.json";

    // Allow everything by default, block mkdir
    const profile = {
      defaultAction: "SCMP_ACT_ALLOW",
      syscalls: [
        {
          names: ["mkdir", "mkdirat"],
          action: "SCMP_ACT_ERRNO",
        },
      ],
    };

    writeFileSync(tempProfilePath, JSON.stringify(profile));

    try {
      const engine = new DockerIsol8({
        mode: "ephemeral",
        security: {
          seccomp: "custom",
          customProfilePath: tempProfilePath,
        },
      });

      const result = await engine.execute({
        code: `
import os
try:
    os.mkdir("/sandbox/testdir")
    print("success")
except OSError as e:
    print(f"failed: {e.errno}")
            `,
        runtime: "python",
      });

      // EPERM = 1
      expect(result.stdout).toContain("failed: 1");
    } finally {
      unlinkSync(tempProfilePath);
    }
  }, 30_000);
});
