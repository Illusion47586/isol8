import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type Docker from "dockerode";
import { DockerIsol8 } from "../../src/engine/docker";
import { getDocker, hasDocker } from "./setup";

const isLinux = process.platform === "linux";

async function pullImage(docker: Docker, image: string) {
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) {
        reject(err);
        return;
      }
      docker.modem.followProgress(stream, (pullErr) => {
        if (pullErr) {
          reject(pullErr);
        } else {
          resolve();
        }
      });
    });
  });
}

async function execInContainer(container: Docker.Container, cmd: string[]) {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({ Tty: false });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const stdout = new (await import("node:stream")).PassThrough();
  const stderr = new (await import("node:stream")).PassThrough();
  interface DockerModem {
    demuxStream: (
      source: NodeJS.ReadableStream,
      stdout: NodeJS.WritableStream,
      stderr: NodeJS.WritableStream
    ) => void;
  }

  (container as Docker.Container & { modem: DockerModem }).modem.demuxStream(
    stream,
    stdout,
    stderr
  );

  stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  const inspect = await exec.inspect();
  return {
    exitCode: inspect.ExitCode ?? 1,
    stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
    stderr: Buffer.concat(stderrChunks).toString("utf-8"),
  };
}

async function waitForHttp(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | undefined;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        return;
      }
      lastError = `HTTP ${resp.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError ?? "unknown error"}`);
}

describe("Integration: Git Operations", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  if (!isLinux) {
    test.skip("Git integration tests require Linux host networking", () => {});
    return;
  }

  const docker = getDocker();
  const image = "gitea/gitea:1.21.11";
  const username = "isol8";
  const password = "isol8-pass";
  const email = "isol8@example.com";
  const repoName = "git-ops-test";

  let container: Docker.Container | null = null;
  let baseUrl = "";
  let hostPort = "";
  let token = "";
  let defaultBranch = "main";

  beforeAll(async () => {
    await pullImage(docker, image);

    container = await docker.createContainer({
      Image: image,
      Env: [
        "USER_UID=1000",
        "USER_GID=1000",
        "GITEA__security__INSTALL_LOCK=true",
        "GITEA__database__DB_TYPE=sqlite3",
        "GITEA__server__ROOT_URL=http://127.0.0.1:3000/",
        "GITEA__server__HTTP_PORT=3000",
        "GITEA__service__DISABLE_REGISTRATION=true",
        "GITEA__log__LEVEL=Error",
      ],
      ExposedPorts: { "3000/tcp": {} },
      HostConfig: { PortBindings: { "3000/tcp": [{ HostPort: "0" }] } },
    });

    await container.start();

    const inspect = await container.inspect();
    const port = inspect.NetworkSettings.Ports?.["3000/tcp"]?.[0]?.HostPort;
    if (!port) {
      throw new Error("Failed to resolve mapped Gitea port");
    }

    hostPort = port;
    baseUrl = `http://127.0.0.1:${hostPort}`;
    await waitForHttp(`${baseUrl}/api/v1/version`, 90_000);

    const userCreate = await execInContainer(container, [
      "gitea",
      "admin",
      "user",
      "create",
      "--username",
      username,
      "--password",
      password,
      "--email",
      email,
      "--admin",
      "--must-change-password=false",
    ]);

    if (userCreate.exitCode !== 0 && !userCreate.stderr.includes("already exists")) {
      throw new Error(`Failed to create gitea user: ${userCreate.stderr}`);
    }

    const tokenResult = await execInContainer(container, [
      "gitea",
      "admin",
      "user",
      "generate-access-token",
      "--username",
      username,
      "--token-name",
      "isol8-ci",
    ]);

    const tokenMatch = tokenResult.stdout.match(/([a-f0-9]{32,})/i);
    if (!tokenMatch) {
      throw new Error(`Failed to parse access token: ${tokenResult.stdout}`);
    }
    token = tokenMatch[1]!;

    const createRepoResp = await fetch(`${baseUrl}/api/v1/user/repos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `token ${token}`,
      },
      body: JSON.stringify({
        name: repoName,
        private: false,
        auto_init: true,
      }),
    });

    if (!createRepoResp.ok) {
      const text = await createRepoResp.text();
      throw new Error(`Failed to create repo: ${createRepoResp.status} ${text}`);
    }

    const repoResp = await fetch(`${baseUrl}/api/v1/repos/${username}/${repoName}`, {
      headers: { Authorization: `token ${token}` },
    });

    if (repoResp.ok) {
      const repoJson = (await repoResp.json()) as { default_branch?: string };
      if (repoJson.default_branch) {
        defaultBranch = repoJson.default_branch;
      }
    }
  }, 180_000);

  afterAll(async () => {
    if (container) {
      try {
        await container.stop({ t: 2 });
      } catch {
        // ignore
      }
      try {
        await container.remove({ force: true });
      } catch {
        // ignore
      }
    }
  });

  test("clone, commit, push within sandbox", async () => {
    const cloneUrl = `http://${username}:${token}@127.0.0.1:${hostPort}/${username}/${repoName}.git`;

    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "host",
      gitSecurity: {
        allowedHosts: ["127.0.0.1", "localhost"],
        allowPrivateIPs: true,
        blockedPatterns: [],
        credentialEnvVars: ["GIT_TOKEN"],
      },
      secrets: {
        GIT_TOKEN: token,
      },
    });

    const result = await engine.execute({
      code: "cd /sandbox/repo && echo 'hello' >> README.md",
      runtime: "bash",
      git: {
        clone: { url: cloneUrl, path: "repo" },
        commit: {
          message: "feat: update",
          authorName: "Isol8 CI",
          authorEmail: "ci@isol8.dev",
          repoPath: "repo",
          all: true,
        },
        push: {
          remote: "origin",
          branch: defaultBranch,
          repoPath: "repo",
        },
      },
    });

    await engine.stop();

    expect(result.exitCode).toBe(0);

    const commitsResp = await fetch(
      `${baseUrl}/api/v1/repos/${username}/${repoName}/commits?limit=5`,
      {
        headers: { Authorization: `token ${token}` },
      }
    );

    expect(commitsResp.ok).toBe(true);
    const commits = (await commitsResp.json()) as Array<{ sha: string }>;
    expect(commits.length).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
