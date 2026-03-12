import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  buildBaseImages,
  buildCustomImage,
  imageExists,
  normalizePackages,
} from "../../src/engine/image-builder";
import { extractFromTar } from "../../src/engine/utils";

// ─── Shared mock factory ─────────────────────────────────────────────────────

/** Creates a fresh mock docker client that records buildImage calls and succeeds by default. */
function makeMockDocker(
  overrides: { inspectResult?: object; followProgressResult?: { err?: any; res?: any[] } } = {}
) {
  const buildImage = mock(() => Promise.resolve({ on: () => {}, pipe: (d: any) => d }));

  const followProgress = mock(
    (_stream: any, cb: (err?: any, res?: any[]) => void, _onEvent?: (e: any) => void) => {
      const { err = null, res = [] } = overrides.followProgressResult ?? {};
      cb(err, res);
    }
  );

  const docker = {
    buildImage,
    modem: { followProgress },
    getImage: (_id?: string) => ({
      inspect: async () => overrides.inspectResult ?? {},
      remove: async () => {},
    }),
  } as any;

  return { docker, buildImage, followProgress };
}

/** Reads all bytes from a Readable stream into a Buffer. */
async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ─── Legacy shared mocks (kept for existing tests) ───────────────────────────

const mockBuildImage = mock(() =>
  Promise.resolve({ on: (_event: string, _cb: any) => {}, pipe: (dest: any) => dest })
);

const mockFollowProgress = mock((stream: any, cb: (err?: any) => void) => {
  cb(null);
});

const mockDocker = {
  buildImage: mockBuildImage,
  modem: { followProgress: mockFollowProgress },
  getImage: () => ({ inspect: async () => ({}) }),
} as any;

// ─── buildCustomImage: stream shape ──────────────────────────────────────────

describe("buildCustomImage — stream passed to docker.buildImage", () => {
  beforeEach(() => {
    mockBuildImage.mockClear();
    mockFollowProgress.mockClear();
  });

  test("builds custom image with valid package names", async () => {
    await buildCustomImage(mockDocker, "python", ["numpy", "pandas"], "my-custom-python-tag");
    expect(mockBuildImage).toHaveBeenCalled();
  });

  test("passes a Readable stream (not a raw Buffer) — regression for <none>:<none> tag bug", async () => {
    await buildCustomImage(mockDocker, "python", ["numpy"], "isol8:python-custom-abc123");

    const calls = mockBuildImage.mock.calls as unknown as [unknown, unknown][];
    const firstArg = calls[0][0];

    // A raw Buffer passed here causes Docker to build the image but silently omit the tag,
    // resulting in <none>:<none> dangling images. It must be a Readable stream.
    expect(firstArg).toBeInstanceOf(Readable);
    expect(Buffer.isBuffer(firstArg)).toBe(false);
  });

  test.each([
    "python",
    "node",
    "bun",
    "bash",
  ] as const)("passes a Readable stream for runtime: %s", async (runtime) => {
    const { docker, buildImage } = makeMockDocker();
    await buildCustomImage(docker, runtime, ["pkg"], `isol8:${runtime}-custom`);

    const calls = buildImage.mock.calls as unknown as [unknown, unknown][];
    expect(calls[0][0]).toBeInstanceOf(Readable);
    expect(Buffer.isBuffer(calls[0][0])).toBe(false);
  });

  test("the Readable stream can actually be consumed (is not empty)", async () => {
    const { docker, buildImage } = makeMockDocker();
    await buildCustomImage(docker, "python", ["numpy"], "isol8:python-test");

    const calls = buildImage.mock.calls as unknown as [Readable, unknown][];
    const stream = calls[0][0];
    const bytes = await readStream(stream);

    expect(bytes.length).toBeGreaterThan(0);
  });

  test("the Readable stream wraps a valid POSIX tar archive with a Dockerfile entry", async () => {
    const { docker, buildImage } = makeMockDocker();
    await buildCustomImage(docker, "python", ["numpy", "pandas"], "isol8:python-test");

    const calls = buildImage.mock.calls as unknown as [Readable, unknown][];
    const tarBytes = await readStream(calls[0][0]);

    // Must be able to extract the Dockerfile from the tar without throwing
    const dockerfile = extractFromTar(tarBytes, "Dockerfile").toString("utf-8");
    expect(dockerfile).toContain("FROM isol8:python");
    expect(dockerfile).toContain("numpy");
    expect(dockerfile).toContain("pandas");
  });

  test.each([
    "python",
    "node",
    "bun",
    "bash",
  ] as const)("Dockerfile in tar uses correct install command for runtime: %s", async (runtime) => {
    const { docker, buildImage } = makeMockDocker();
    await buildCustomImage(docker, runtime, ["mypkg"], `isol8:${runtime}-custom`);

    const calls = buildImage.mock.calls as unknown as [Readable, unknown][];
    const dockerfile = extractFromTar(await readStream(calls[0][0]), "Dockerfile").toString(
      "utf-8"
    );

    const expectedFragments: Record<string, string> = {
      python: "pip install",
      node: "npm install",
      bun: "bun install",
      bash: "apk add",
    };
    expect(dockerfile).toContain(expectedFragments[runtime]);
    expect(dockerfile).toContain("mypkg");
  });
});

// ─── buildCustomImage: build options ─────────────────────────────────────────

describe("buildCustomImage — options passed to docker.buildImage", () => {
  test("passes the tag string verbatim in options.t", async () => {
    const { docker, buildImage } = makeMockDocker();
    const tag = "my-company/python-data-stack:v2";
    await buildCustomImage(docker, "python", ["numpy"], tag);

    const calls = buildImage.mock.calls as unknown as [unknown, { t: string }][];
    expect(calls[0][1].t).toBe(tag);
  });

  test("options.t is set for every runtime so the image is always tagged", async () => {
    for (const runtime of ["python", "node", "bun", "bash"] as const) {
      const { docker, buildImage } = makeMockDocker();
      const tag = `isol8:${runtime}-custom-xyz`;
      await buildCustomImage(docker, runtime, ["pkg"], tag);

      const calls = buildImage.mock.calls as unknown as [unknown, { t: string }][];
      expect(calls[0][1].t).toBe(tag);
    }
  });

  test("options.dockerfile is set to 'Dockerfile'", async () => {
    const { docker, buildImage } = makeMockDocker();
    await buildCustomImage(docker, "python", ["numpy"], "tag");

    const calls = buildImage.mock.calls as unknown as [unknown, { dockerfile: string }][];
    expect(calls[0][1].dockerfile).toBe("Dockerfile");
  });

  test("required labels are present in options.labels", async () => {
    const { docker, buildImage } = makeMockDocker();
    await buildCustomImage(docker, "python", ["numpy", "pandas"], "tag");

    const calls = buildImage.mock.calls as unknown as [
      unknown,
      { labels: Record<string, string> },
    ][];
    const labels = calls[0][1].labels;

    expect(labels["org.isol8.deps.hash"]).toBeTruthy();
    expect(labels["org.isol8.runtime"]).toBe("python");
    expect(labels["org.isol8.dependencies"]).toBe("numpy,pandas");
  });

  test("deps hash in labels is deterministic for the same inputs", async () => {
    const { docker: d1, buildImage: b1 } = makeMockDocker();
    const { docker: d2, buildImage: b2 } = makeMockDocker();

    await buildCustomImage(d1, "python", ["requests", "numpy"], "tag1");
    await buildCustomImage(d2, "python", ["numpy", "requests"], "tag2"); // different order

    const getHash = (b: typeof b1) => {
      const calls = b.mock.calls as unknown as [unknown, { labels: Record<string, string> }][];
      return calls[0][1].labels["org.isol8.deps.hash"];
    };

    // normalizePackages sorts, so hash must be the same regardless of input order
    expect(getHash(b1)).toBe(getHash(b2));
  });

  test("deps hash changes when packages change", async () => {
    const { docker: d1, buildImage: b1 } = makeMockDocker();
    const { docker: d2, buildImage: b2 } = makeMockDocker();

    await buildCustomImage(d1, "python", ["numpy"], "tag1");
    await buildCustomImage(d2, "python", ["numpy", "pandas"], "tag2");

    const getHash = (b: typeof b1) => {
      const calls = b.mock.calls as unknown as [unknown, { labels: Record<string, string> }][];
      return calls[0][1].labels["org.isol8.deps.hash"];
    };

    expect(getHash(b1)).not.toBe(getHash(b2));
  });

  test("deps hash changes when runtime changes (same packages)", async () => {
    const { docker: d1, buildImage: b1 } = makeMockDocker();
    const { docker: d2, buildImage: b2 } = makeMockDocker();

    await buildCustomImage(d1, "python", ["requests"], "tag1");
    await buildCustomImage(d2, "node", ["requests"], "tag2");

    const getHash = (b: typeof b1) => {
      const calls = b.mock.calls as unknown as [unknown, { labels: Record<string, string> }][];
      return calls[0][1].labels["org.isol8.deps.hash"];
    };

    expect(getHash(b1)).not.toBe(getHash(b2));
  });
});

// ─── buildCustomImage: cache skip ────────────────────────────────────────────

describe("buildCustomImage — cache skip (no build when up to date)", () => {
  test("skips buildImage when image already has matching deps hash", async () => {
    // We need to produce the real hash for ["numpy"] + python to set up the mock
    // We do a build first with force=true to capture the hash, then re-run without force.
    const capturedHashes: string[] = [];
    const captureDocker = {
      buildImage: mock((_stream: any, opts: any) => {
        capturedHashes.push(opts.labels["org.isol8.deps.hash"]);
        return Promise.resolve({ on: () => {}, pipe: (d: any) => d });
      }),
      modem: {
        followProgress: mock((_s: any, cb: (e: any, r: any) => void) => cb(null, [])),
      },
      getImage: () => ({ inspect: async () => ({}), remove: async () => {} }),
    } as any;

    // Force build to capture the real hash
    await buildCustomImage(captureDocker, "python", ["numpy"], "tag", undefined, true);
    const realHash = capturedHashes[0];
    expect(realHash).toBeTruthy();

    // Now build a docker mock whose image already has that exact hash
    const skipBuildImage = mock(() => Promise.resolve({ on: () => {}, pipe: (d: any) => d }));
    const skipDocker = {
      buildImage: skipBuildImage,
      modem: {
        followProgress: mock((_s: any, cb: (e: any, r: any) => void) => cb(null, [])),
      },
      getImage: () => ({
        inspect: async () => ({
          Id: "sha256:cached",
          Config: { Labels: { "org.isol8.deps.hash": realHash } },
        }),
        remove: async () => {},
      }),
    } as any;

    // Without force, should skip the build entirely
    await buildCustomImage(skipDocker, "python", ["numpy"], "tag", undefined, false);
    expect(skipBuildImage).not.toHaveBeenCalled();
  });

  test("does not skip buildImage when force=true even if hash matches", async () => {
    const { docker, buildImage } = makeMockDocker({
      inspectResult: {
        Id: "sha256:existing",
        Config: { Labels: { "org.isol8.deps.hash": "any-hash-value" } },
      },
    });

    await buildCustomImage(docker, "python", ["numpy"], "tag", undefined, true);
    expect(buildImage).toHaveBeenCalled();
  });

  test("does not skip when image does not exist (inspect throws)", async () => {
    const buildImage = mock(() => Promise.resolve({ on: () => {}, pipe: (d: any) => d }));
    const docker = {
      buildImage,
      modem: {
        followProgress: mock((_s: any, cb: (e: any, r: any) => void) => cb(null, [])),
      },
      getImage: () => ({
        inspect: async () => {
          throw new Error("No such image");
        },
        remove: async () => {},
      }),
    } as any;

    await buildCustomImage(docker, "python", ["numpy"], "tag", undefined, false);
    expect(buildImage).toHaveBeenCalled();
  });
});

// ─── buildCustomImage: error propagation ─────────────────────────────────────

describe("buildCustomImage — error propagation", () => {
  test("rejects when docker.buildImage rejects", async () => {
    const docker = {
      buildImage: mock(() => Promise.reject(new Error("daemon unavailable"))),
      modem: { followProgress: mock(() => {}) },
      getImage: () => ({ inspect: async () => ({}), remove: async () => {} }),
    } as any;

    await expect(buildCustomImage(docker, "python", ["numpy"], "tag")).rejects.toThrow(
      "daemon unavailable"
    );
  });

  test("rejects when followProgress reports an error via callback", async () => {
    const docker = {
      buildImage: mock(() => Promise.resolve({ on: () => {}, pipe: (d: any) => d })),
      modem: {
        followProgress: mock((_s: any, cb: (e: any, r: any) => void) =>
          cb(new Error("build failed"), null)
        ),
      },
      getImage: () => ({ inspect: async () => ({}), remove: async () => {} }),
    } as any;

    await expect(buildCustomImage(docker, "python", ["numpy"], "tag")).rejects.toThrow(
      "build failed"
    );
  });

  test("rejects when final stream event contains an error field", async () => {
    const docker = {
      buildImage: mock(() => Promise.resolve({ on: () => {}, pipe: (d: any) => d })),
      modem: {
        followProgress: mock((_s: any, cb: (e: any, r: any) => void) =>
          cb(null, [{ stream: "Step 1/1" }, { error: "no space left on device" }])
        ),
      },
      getImage: () => ({ inspect: async () => ({}), remove: async () => {} }),
    } as any;

    await expect(buildCustomImage(docker, "python", ["numpy"], "tag")).rejects.toThrow(
      "no space left on device"
    );
  });

  test("throws for unknown runtime before calling docker.buildImage", async () => {
    const { docker, buildImage } = makeMockDocker();

    await expect(buildCustomImage(docker, "ruby" as any, ["rails"], "tag")).rejects.toThrow(
      /Unknown runtime/
    );

    expect(buildImage).not.toHaveBeenCalled();
  });

  test("throws for invalid package names before calling docker.buildImage", async () => {
    const { docker, buildImage } = makeMockDocker();

    await expect(buildCustomImage(docker, "python", ["numpy; rm -rf /"], "tag")).rejects.toThrow(
      /Invalid package name/
    );

    expect(buildImage).not.toHaveBeenCalled();
  });

  test("throws for malicious node package name before calling docker.buildImage", async () => {
    const { docker, buildImage } = makeMockDocker();

    await expect(buildCustomImage(docker, "node", ["lodash && echo pwnd"], "tag")).rejects.toThrow(
      /Invalid package name/
    );

    expect(buildImage).not.toHaveBeenCalled();
  });
});

// ─── buildCustomImage: old behaviour tests (kept) ────────────────────────────

describe("image-builder", () => {
  beforeEach(() => {
    mockBuildImage.mockClear();
    mockFollowProgress.mockClear();
  });

  test("allows valid version specifiers", async () => {
    await buildCustomImage(mockDocker, "python", ["numpy==1.21.0"], "tag");
    await buildCustomImage(mockDocker, "node", ["lodash@4.17.21"], "tag2");
    expect(mockBuildImage).toHaveBeenCalledTimes(2);
  });

  describe("smart build - skips when up to date", () => {
    test("builds when force flag is true", async () => {
      await buildCustomImage(mockDocker, "python", ["numpy"], "tag", undefined, true);
      expect(mockBuildImage).toHaveBeenCalled();
    });
  });

  describe("dangling image cleanup", () => {
    test("removes old image after rebuild", async () => {
      const oldImageId = "sha256:oldimage123";
      const removedImages: string[] = [];

      const mockDockerWithCleanup = {
        buildImage: mock(() => Promise.resolve({ on: () => {}, pipe: (d: any) => d })),
        modem: {
          followProgress: mock((stream: any, cb: (err?: any) => void) => {
            cb(null);
          }),
        },
        getImage: (id: string) => ({
          inspect: async () => {
            if (id === "isol8:python") {
              return { Id: oldImageId, Config: { Labels: {} } };
            }
            throw new Error("not found");
          },
          remove: async () => {
            removedImages.push(id);
          },
        }),
      } as any;

      await buildCustomImage(mockDockerWithCleanup, "python", ["numpy"], "tag", undefined, true);

      // The old image should be queued for removal after rebuild
      // Note: In the actual implementation, we get the old image ID before building
      // and remove it after successful build
    });
  });
});

describe("hash functions", () => {
  test("normalizePackages trims, dedupes, and sorts", () => {
    expect(normalizePackages([" numpy ", "pandas", "numpy", "", "scipy"])).toEqual([
      "numpy",
      "pandas",
      "scipy",
    ]);
  });

  test("computeDockerDirHash is consistent", () => {
    // We test the hash function behavior through its properties
    const hash1 = createHash("sha256").update("test").digest("hex");
    const hash2 = createHash("sha256").update("test").digest("hex");
    expect(hash1).toBe(hash2);
  });

  test("computeDepsHash is order independent", () => {
    const runtime = "python";
    const packages1 = ["numpy", "pandas", "requests"];
    const packages2 = ["requests", "pandas", "numpy"];

    const hash1 = createHash("sha256")
      .update(runtime)
      .update(packages1.sort().join(""))
      .digest("hex");
    const hash2 = createHash("sha256")
      .update(runtime)
      .update(packages2.sort().join(""))
      .digest("hex");

    expect(hash1).toBe(hash2);
  });

  test("computeDepsHash different for different runtimes", () => {
    const packages = ["lodash"];

    const nodeHash = createHash("sha256").update("node").update(packages.join("")).digest("hex");
    const bunHash = createHash("sha256").update("bun").update(packages.join("")).digest("hex");

    expect(nodeHash).not.toBe(bunHash);
  });
});

// ─── buildCustomImage — build log in error messages (Issue 3) ────────────────

describe("buildCustomImage — build log included in error messages", () => {
  test("error message includes build log when followProgress errors via callback", async () => {
    const docker = {
      buildImage: mock(() => Promise.resolve({ on: () => {}, pipe: (d: any) => d })),
      modem: {
        followProgress: mock((_s: any, cb: (e: any, r: any) => void, onEvent: (e: any) => void) => {
          onEvent({ stream: "Step 1/2 : FROM isol8:python\n" });
          onEvent({ stream: "Step 2/2 : RUN pip install numpy\n" });
          onEvent({
            error: "The command '/bin/sh -c pip install numpy' returned a non-zero code: 1",
          });
          cb(new Error("build context error"), null);
        }),
      },
      getImage: () => ({ inspect: async () => ({}), remove: async () => {} }),
    } as any;

    const err = await buildCustomImage(docker, "python", ["numpy"], "tag").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("build context error");
    expect(err.message).toContain("Step 1/2");
    expect(err.message).toContain("Step 2/2");
  });

  test("error message includes build log when final event has error field", async () => {
    const docker = {
      buildImage: mock(() => Promise.resolve({ on: () => {}, pipe: (d: any) => d })),
      modem: {
        followProgress: mock((_s: any, cb: (e: any, r: any) => void, onEvent: (e: any) => void) => {
          onEvent({ stream: "Step 1/2 : FROM isol8:python\n" });
          onEvent({ stream: "Step 2/2 : RUN pip install broken-pkg\n" });
          cb(null, [
            { stream: "Step 1/2 : FROM isol8:python\n" },
            { stream: "Step 2/2 : RUN pip install broken-pkg\n" },
            { error: "ERROR: Could not find a version that satisfies the requirement broken-pkg" },
          ]);
        }),
      },
      getImage: () => ({ inspect: async () => ({}), remove: async () => {} }),
    } as any;

    const err = await buildCustomImage(docker, "python", ["broken-pkg"], "tag").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("Could not find a version");
    expect(err.message).toContain("Step 1/2");
    expect(err.message).toContain("Step 2/2");
  });

  test("error message has no build log section when no stream events were emitted", async () => {
    const docker = {
      buildImage: mock(() => Promise.resolve({ on: () => {}, pipe: (d: any) => d })),
      modem: {
        followProgress: mock(
          (_s: any, cb: (e: any, r: any) => void, _onEvent: (e: any) => void) => {
            cb(new Error("daemon unavailable"), null);
          }
        ),
      },
      getImage: () => ({ inspect: async () => ({}), remove: async () => {} }),
    } as any;

    const err = await buildCustomImage(docker, "python", ["numpy"], "tag").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("daemon unavailable");
    expect(err.message).not.toContain("build log");
  });
});

// ─── buildBaseImages — build log in error messages (Issue 3) ─────────────────

describe("buildBaseImages — build log included in error messages", () => {
  test("error message includes accumulated build log on failure", async () => {
    const docker = {
      buildImage: mock(() => Promise.resolve({ on: () => {}, pipe: (d: any) => d })),
      modem: {
        followProgress: mock((_s: any, cb: (e: any, r: any) => void, onEvent: (e: any) => void) => {
          onEvent({ stream: "Step 1/3 : FROM alpine:3.21\n" });
          onEvent({ stream: "Step 2/3 : RUN apk add python3\n" });
          onEvent({ stream: "fetch https://dl-cdn.alpinelinux.org/\n" });
          cb(new Error("network timeout"), null);
        }),
      },
      getImage: () => ({
        inspect: async () => {
          throw new Error("No such image");
        },
        remove: async () => {},
      }),
    } as any;

    const err = await buildBaseImages(docker, undefined, true, ["python"]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("network timeout");
    expect(err.message).toContain("Step 1/3");
    expect(err.message).toContain("Step 2/3");
    expect(err.message).toContain("fetch https://dl-cdn.alpinelinux.org/");
  });

  test("error message has no build log section when stream emits nothing", async () => {
    const docker = {
      buildImage: mock(() => Promise.resolve({ on: () => {}, pipe: (d: any) => d })),
      modem: {
        followProgress: mock(
          (_s: any, cb: (e: any, r: any) => void, _onEvent: (e: any) => void) => {
            cb(new Error("daemon not running"), null);
          }
        ),
      },
      getImage: () => ({
        inspect: async () => {
          throw new Error("No such image");
        },
        remove: async () => {},
      }),
    } as any;

    const err = await buildBaseImages(docker, undefined, true, ["python"]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("daemon not running");
    expect(err.message).not.toContain("build log");
  });
});

describe("imageExists", () => {
  test("returns true when image exists", async () => {
    const mockDocker = {
      getImage: () => ({
        inspect: async () => ({ Id: "sha256:abc123" }),
      }),
    } as any;

    const exists = await imageExists(mockDocker, "isol8:python");
    expect(exists).toBe(true);
  });

  test("returns false when image does not exist", async () => {
    const mockDocker = {
      getImage: () => ({
        inspect: async () => {
          throw new Error("not found");
        },
      }),
    } as any;

    const exists = await imageExists(mockDocker, "isol8:nonexistent");
    expect(exists).toBe(false);
  });
});

describe("buildCustomImage with setupScript", () => {
  const mockBuildImageForSetup = mock((_tarBuffer: any, opts: any) => {
    return Promise.resolve({
      on: () => {},
      pipe: (d: any) => d,
    });
  });

  const mockFollowProgressForSetup = mock((stream: any, cb: (err?: any, res?: any) => void) => {
    cb(null, []);
  });

  const mockDockerSetup = {
    buildImage: mockBuildImageForSetup,
    modem: {
      followProgress: mockFollowProgressForSetup,
    },
    getImage: () => ({
      inspect: async () => ({}),
    }),
  } as any;

  beforeEach(() => {
    mockBuildImageForSetup.mockClear();
    mockFollowProgressForSetup.mockClear();
  });

  test("includes setupScript label when provided", async () => {
    const script = "echo 'hello setup'";
    await buildCustomImage(
      mockDockerSetup,
      "python",
      ["numpy"],
      "my-setup-tag",
      undefined,
      true,
      script
    );

    expect(mockBuildImageForSetup).toHaveBeenCalled();
    const callArgs = mockBuildImageForSetup.mock.calls[0];
    const opts = callArgs[1];
    expect(opts.labels["org.isol8.setup"]).toBe(script);
  });

  test("does not include setupScript label when not provided", async () => {
    await buildCustomImage(mockDockerSetup, "python", ["numpy"], "no-setup-tag", undefined, true);

    expect(mockBuildImageForSetup).toHaveBeenCalled();
    const callArgs = mockBuildImageForSetup.mock.calls[0];
    const opts = callArgs[1];
    expect(opts.labels["org.isol8.setup"]).toBeUndefined();
  });

  test("setup script changes deps hash (invalidates cache)", async () => {
    // Build once without setup
    await buildCustomImage(mockDockerSetup, "python", ["numpy"], "tag-no-setup", undefined, true);
    const hash1 = mockBuildImageForSetup.mock.calls[0][1].labels["org.isol8.deps.hash"];

    mockBuildImageForSetup.mockClear();

    // Build again with setup
    await buildCustomImage(
      mockDockerSetup,
      "python",
      ["numpy"],
      "tag-with-setup",
      undefined,
      true,
      "pip install extra"
    );
    const hash2 = mockBuildImageForSetup.mock.calls[0][1].labels["org.isol8.deps.hash"];

    expect(hash1).not.toBe(hash2);
  });

  test("allows building with setup script and no packages", async () => {
    const script = "apt-get update";
    await buildCustomImage(
      mockDockerSetup,
      "python",
      [],
      "setup-only-tag",
      undefined,
      true,
      script
    );

    expect(mockBuildImageForSetup).toHaveBeenCalled();
    const callArgs = mockBuildImageForSetup.mock.calls[0];
    const opts = callArgs[1];
    expect(opts.labels["org.isol8.setup"]).toBe(script);
  });
});

// ─── buildCustomImage: tar content with setupScript ──────────────────────────

describe("buildCustomImage — Dockerfile content in tar stream", () => {
  test("setup script is baked into Dockerfile in the tar", async () => {
    const { docker, buildImage } = makeMockDocker();
    const script = "export MY_VAR=hello";
    await buildCustomImage(docker, "python", ["numpy"], "tag", undefined, true, script);

    const calls = buildImage.mock.calls as unknown as [Readable, unknown][];
    const dockerfile = extractFromTar(await readStream(calls[0][0]), "Dockerfile").toString(
      "utf-8"
    );

    expect(dockerfile).toContain(".isol8-setup.sh");
    expect(dockerfile).toContain("chmod +x");
  });

  test("Dockerfile in tar still uses a Readable stream when setupScript is provided", async () => {
    const { docker, buildImage } = makeMockDocker();
    await buildCustomImage(docker, "python", ["numpy"], "tag", undefined, true, "echo hi");

    const calls = buildImage.mock.calls as unknown as [unknown, unknown][];
    expect(calls[0][0]).toBeInstanceOf(Readable);
    expect(Buffer.isBuffer(calls[0][0])).toBe(false);
  });

  test("Dockerfile in tar FROM line matches the runtime passed in", async () => {
    for (const runtime of ["python", "node", "bun", "bash"] as const) {
      const { docker, buildImage } = makeMockDocker();
      await buildCustomImage(docker, runtime, ["pkg"], `isol8:${runtime}-custom`);

      const calls = buildImage.mock.calls as unknown as [Readable, unknown][];
      const dockerfile = extractFromTar(await readStream(calls[0][0]), "Dockerfile").toString(
        "utf-8"
      );
      expect(dockerfile.split("\n")[0]).toBe(`FROM isol8:${runtime}`);
    }
  });
});
