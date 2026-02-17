import { beforeEach, describe, expect, mock, test } from "bun:test";
import { buildCustomImages } from "../../src/engine/image-builder";
import type { Isol8Config } from "../../src/types";

// Mock Dockerode
const mockBuildImage = mock(() => {
  return Promise.resolve({
    // Mock stream
    on: (event: string, cb: any) => {},
    pipe: (dest: any) => dest, // Helper for piping if needed
  });
});

const mockFollowProgress = mock((stream: any, cb: (err?: any) => void) => {
  cb(null); // Success
});

const mockDocker = {
  buildImage: mockBuildImage,
  modem: {
    followProgress: mockFollowProgress,
  },
  getImage: () => ({
    inspect: async () => ({}),
  }),
} as any;

describe("image-builder", () => {
  beforeEach(() => {
    mockBuildImage.mockClear();
    mockFollowProgress.mockClear();
  });

  test("builds custom image with valid package names", async () => {
    const config = {
      dependencies: {
        python: ["numpy", "pandas"],
      },
    } as Isol8Config;

    await buildCustomImages(mockDocker, config);

    expect(mockBuildImage).toHaveBeenCalled();
    // Verify arguments to buildImage (harder with tar stream, but we can verify it was called)
  });

  test("throws error for malicious python package name", async () => {
    const config = {
      dependencies: {
        python: ["numpy; rm -rf /"],
      },
    } as Isol8Config;

    // This should fail once validation is added
    // For now (before fix), checking that it DOES NOT throw would show the bug,
    // but we want to assert the DESIRED behavior (throwing error).
    expect(buildCustomImages(mockDocker, config)).rejects.toThrow(/Invalid package name/);
  });

  test("throws error for malicious node package name", async () => {
    const config = {
      dependencies: {
        node: ["lodash && echo 'pwnd'"],
      },
    } as Isol8Config;

    expect(buildCustomImages(mockDocker, config)).rejects.toThrow(/Invalid package name/);
  });

  test("allows valid version specifiers", async () => {
    const config = {
      dependencies: {
        python: ["numpy==1.21.0"],
        node: ["lodash@4.17.21"],
      },
    } as Isol8Config;

    await buildCustomImages(mockDocker, config);
    expect(mockBuildImage).toHaveBeenCalledTimes(2);
  });
});
