import { beforeEach, describe, expect, mock, test } from "bun:test";
import { DockerIsol8 } from "../../src/engine/docker";
import { PythonAdapter } from "../../src/runtime";

class TestDockerIsol8 extends DockerIsol8 {
  testResolveImage(adapter: any, pkgs: string[] | undefined) {
    return (this as any).resolveImage(adapter, pkgs);
  }
}

describe("DockerIsol8 - resolveImage", () => {
  let engine: TestDockerIsol8;
  const mockListImages = mock();
  const mockGetImage = mock();

  beforeEach(() => {
    mockListImages.mockClear();
    mockGetImage.mockClear();

    mockGetImage.mockReturnValue({
      inspect: () => Promise.resolve({}),
    });

    const mockDocker = {
      listImages: mockListImages,
      getImage: mockGetImage,
    } as any;

    engine = new TestDockerIsol8({ mode: "ephemeral" });
    // Override docker instance
    (engine as any).docker = mockDocker;
  });

  const adapter = PythonAdapter;

  test("returns explicit image if provided", async () => {
    const customEngine = new TestDockerIsol8({ mode: "ephemeral", image: "my-explicit-image" });
    (customEngine as any).docker = { getImage: mockGetImage };

    const result = await customEngine.testResolveImage(adapter, ["numpy"]);
    expect(result.image).toBe("my-explicit-image");
    expect(result.remainingPackages).toEqual(["numpy"]); // Explicit image bypasses metadata checks
  });

  test("falls back to base image if no packages requested", async () => {
    const result = await engine.testResolveImage(adapter, []);
    expect(result.image).toBe("isol8:python");
    expect(result.remainingPackages).toEqual([]);
    expect(mockListImages).not.toHaveBeenCalled();
  });

  test("falls back to base image if no match is found", async () => {
    mockListImages.mockResolvedValue([
      {
        RepoTags: ["other-image:latest"],
        Labels: { "org.isol8.runtime": "node" },
      },
    ]);

    const result = await engine.testResolveImage(adapter, ["numpy"]);
    expect(result.image).toBe("isol8:python");
    expect(result.remainingPackages).toEqual(["numpy"]);
  });

  test("finds exact dependency match", async () => {
    mockListImages.mockResolvedValue([
      {
        RepoTags: ["custom-python-numpy:latest"],
        Labels: {
          "org.isol8.runtime": "python",
          "org.isol8.dependencies": "numpy",
        },
      },
    ]);

    const result = await engine.testResolveImage(adapter, ["numpy"]);
    expect(result.image).toBe("custom-python-numpy:latest");
    expect(result.remainingPackages).toEqual([]);
  });

  test("finds superset dependency match", async () => {
    mockListImages.mockResolvedValue([
      {
        RepoTags: ["custom-python-data:latest"],
        Labels: {
          "org.isol8.runtime": "python",
          "org.isol8.dependencies": "numpy,pandas,scipy",
        },
      },
    ]);

    const result = await engine.testResolveImage(adapter, ["numpy", "pandas"]);
    expect(result.image).toBe("custom-python-data:latest");
    expect(result.remainingPackages).toEqual([]);
  });

  test("prefers exact match over superset", async () => {
    mockListImages.mockResolvedValue([
      {
        RepoTags: ["custom-python-superset:latest"],
        Labels: {
          "org.isol8.runtime": "python",
          "org.isol8.dependencies": "numpy,pandas,scipy",
        },
      },
      {
        RepoTags: ["custom-python-exact:latest"],
        Labels: {
          "org.isol8.runtime": "python",
          "org.isol8.dependencies": "numpy,pandas",
        },
      },
    ]);

    const result = await engine.testResolveImage(adapter, ["numpy", "pandas"]);
    // Since we sort the images, it's deterministic based on the order and breaking logic.
    // The exact match should break the loop when found.
    expect(result.image).toBe("custom-python-exact:latest");
  });
});
