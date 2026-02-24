import { PassThrough } from "node:stream";
import type Docker from "dockerode";
import { createTarBuffer, extractFromTar } from "../utils";

export interface VolumeManagerOptions {
  readonlyRootFs: boolean;
  sandboxWorkdir?: string;
}

export class VolumeManager {
  private readonly readonlyRootFs: boolean;
  private readonly sandboxWorkdir: string;

  constructor(options: VolumeManagerOptions) {
    this.readonlyRootFs = options.readonlyRootFs;
    this.sandboxWorkdir = options.sandboxWorkdir ?? "/sandbox";
  }

  async writeFileViaExec(
    container: Docker.Container,
    filePath: string,
    content: Buffer | string
  ): Promise<void> {
    const data = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
    const b64 = data.toString("base64");

    if (b64.length < 20_000) {
      const exec = await container.exec({
        Cmd: ["sh", "-c", `printf '%s' '${b64}' | base64 -d > ${filePath}`],
        User: "sandbox",
      });

      await exec.start({ Detach: true });

      let info = await exec.inspect();
      while (info.Running) {
        await new Promise((r) => setTimeout(r, 5));
        info = await exec.inspect();
      }

      if (info.ExitCode !== 0) {
        throw new Error(
          `Failed to write file ${filePath} in container (exit code ${info.ExitCode})`
        );
      }
      return;
    }

    const tempPath = `/tmp/b64_${Date.now()}.tmp`;

    const chunkSize = 8000;
    for (let i = 0; i < b64.length; i += chunkSize) {
      const chunk = b64.slice(i, i + chunkSize);
      const exec = await container.exec({
        Cmd: ["sh", "-c", `printf '%s' '${chunk}' >> ${tempPath}`],
        User: "sandbox",
      });
      await exec.start({ Detach: true });
      await exec.inspect();
    }

    const decodeExec = await container.exec({
      Cmd: ["sh", "-c", `base64 -d ${tempPath} > ${filePath} && rm ${tempPath}`],
      User: "sandbox",
    });
    await decodeExec.start({ Detach: true });

    let info = await decodeExec.inspect();
    while (info.Running) {
      await new Promise((r) => setTimeout(r, 5));
      info = await decodeExec.inspect();
    }

    if (info.ExitCode !== 0) {
      throw new Error(`Failed to write file ${filePath} in container (exit code ${info.ExitCode})`);
    }
  }

  async readFileViaExec(container: Docker.Container, filePath: string): Promise<Buffer> {
    const exec = await container.exec({
      Cmd: ["base64", filePath],
      AttachStdout: true,
      AttachStderr: true,
      User: "sandbox",
    });

    const stream = await exec.start({ Tty: false });

    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    stdoutStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stderrStream.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    await new Promise<void>((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const inspectResult = await exec.inspect();
    if (inspectResult.ExitCode !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
      throw new Error(
        `Failed to read file ${filePath} in container: ${stderr} (exit code ${inspectResult.ExitCode})`
      );
    }

    const b64Output = Buffer.concat(chunks).toString("utf-8").trim();
    return Buffer.from(b64Output, "base64");
  }

  async getFileFromContainer(container: Docker.Container, path: string): Promise<Buffer> {
    const stream = await container.getArchive({ path });
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return extractFromTar(Buffer.concat(chunks), path);
  }

  async retrieveFiles(
    container: Docker.Container,
    paths: string[]
  ): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    for (const p of paths) {
      try {
        const buf = this.readonlyRootFs
          ? await this.readFileViaExec(container, p)
          : await this.getFileFromContainer(container, p);
        files[p] = buf.toString("base64");
      } catch {
        // Skip files that don't exist
      }
    }
    return files;
  }

  async putFile(
    container: Docker.Container,
    path: string,
    content: Buffer | string
  ): Promise<void> {
    if (this.readonlyRootFs) {
      await this.writeFileViaExec(container, path, content);
    } else {
      const tar = createTarBuffer(path, content);
      await container.putArchive(tar, { path: "/" });
    }
  }

  async getFile(container: Docker.Container, path: string): Promise<Buffer> {
    if (this.readonlyRootFs) {
      return this.readFileViaExec(container, path);
    }
    return this.getFileFromContainer(container, path);
  }
}
