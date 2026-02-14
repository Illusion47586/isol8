/**
 * Detailed timing benchmark: breaks down where time is spent
 * in the ephemeral execution lifecycle.
 *
 * Usage: bunx tsx benchmarks/spawn-detailed.ts
 */

import { PassThrough } from "node:stream";
import Docker from "dockerode";

const docker = new Docker();
const SANDBOX = "/sandbox";

async function benchDetailed(
  runtime: string,
  image: string,
  cmd: string[],
  code: string,
  ext: string
) {
  const times: Record<string, number> = {};
  let t = performance.now();

  // 1. Create container
  const container = await docker.createContainer({
    Image: image,
    Cmd: ["sleep", "infinity"],
    WorkingDir: SANDBOX,
    NetworkDisabled: true,
    HostConfig: {
      Memory: 512 * 1024 * 1024,
      NanoCpus: 1e9,
      PidsLimit: 64,
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m", [SANDBOX]: "rw,size=64m" },
      SecurityOpt: ["no-new-privileges"],
    },
    StopTimeout: 2,
  });
  times.create = performance.now() - t;

  // 2. Start container
  t = performance.now();
  await container.start();
  times.start = performance.now() - t;

  // 3. Write code via exec (base64 approach)
  t = performance.now();
  const filePath = `${SANDBOX}/main${ext}`;
  const b64 = Buffer.from(code).toString("base64");
  const writeExec = await container.exec({
    Cmd: ["sh", "-c", `echo '${b64}' | base64 -d > ${filePath}`],
  });
  await writeExec.start({ Detach: true });
  // Wait for completion
  let info = await writeExec.inspect();
  while (info.Running) {
    await new Promise((r) => setTimeout(r, 5));
    info = await writeExec.inspect();
  }
  times.writeCode = performance.now() - t;

  // 4. Create exec
  t = performance.now();
  const exec = await container.exec({
    Cmd: ["timeout", "-s", "KILL", "30", ...cmd],
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: SANDBOX,
  });
  times.createExec = performance.now() - t;

  // 5. Start exec + collect output
  t = performance.now();
  const stream = await exec.start({ Tty: false });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  container.modem.demuxStream(stream, stdout, stderr);

  await new Promise<void>((resolve) => {
    stream.on("end", resolve);
  });
  times.execRun = performance.now() - t;

  // 6. Cleanup
  t = performance.now();
  await container.remove({ force: true });
  times.cleanup = performance.now() - t;

  const total = Object.values(times).reduce((a, b) => a + b, 0);
  return { times, total };
}

async function main() {
  const runtimes = [
    {
      name: "python",
      image: "isol8:python",
      cmd: ["python3", "/sandbox/main.py"],
      code: 'print("hello")',
      ext: ".py",
    },
    {
      name: "node",
      image: "isol8:node",
      cmd: ["node", "/sandbox/main.js"],
      code: 'console.log("hello")',
      ext: ".js",
    },
    {
      name: "bun",
      image: "isol8:bun",
      cmd: ["bun", "/sandbox/main.ts"],
      code: 'console.log("hello")',
      ext: ".ts",
    },
    {
      name: "bash",
      image: "isol8:bash",
      cmd: ["bash", "/sandbox/main.sh"],
      code: "echo hello",
      ext: ".sh",
    },
  ];

  console.log("\n⏱  Detailed Spawn Breakdown (ms)\n");
  console.log("Runtime  | create | start  | write  | mkExec | run    | cleanup | TOTAL");
  console.log("---------|--------|--------|--------|--------|--------|---------|------");

  for (const rt of runtimes) {
    const { times, total } = await benchDetailed(rt.name, rt.image, rt.cmd, rt.code, rt.ext);
    console.log(
      `${rt.name.padEnd(8)} | ` +
        `${times.create.toFixed(0).padStart(6)} | ` +
        `${times.start.toFixed(0).padStart(6)} | ` +
        `${times.writeCode.toFixed(0).padStart(6)} | ` +
        `${times.createExec.toFixed(0).padStart(6)} | ` +
        `${times.execRun.toFixed(0).padStart(6)} | ` +
        `${times.cleanup.toFixed(0).padStart(7)} | ` +
        `${total.toFixed(0).padStart(5)}`
    );
  }

  console.log("");
}

main().catch(console.error);
