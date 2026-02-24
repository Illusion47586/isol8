import type Docker from "dockerode";
import type { NetworkFilterConfig, NetworkMode } from "../../types";
import { logger } from "../../utils/logger";

const PROXY_PORT = 8118;
const PROXY_STARTUP_TIMEOUT_MS = 5000;
const PROXY_POLL_INTERVAL_MS = 100;

export interface NetworkManagerOptions {
  network: NetworkMode;
  networkFilter?: NetworkFilterConfig;
}

export class NetworkManager {
  private readonly network: NetworkMode;
  private readonly networkFilter?: NetworkFilterConfig;

  constructor(options: NetworkManagerOptions) {
    this.network = options.network;
    this.networkFilter = options.networkFilter;
  }

  async startProxy(container: Docker.Container): Promise<void> {
    if (this.network !== "filtered") {
      return;
    }

    const envParts: string[] = [];
    if (this.networkFilter) {
      envParts.push(`ISOL8_WHITELIST='${JSON.stringify(this.networkFilter.whitelist)}'`);
      envParts.push(`ISOL8_BLACKLIST='${JSON.stringify(this.networkFilter.blacklist)}'`);
    }
    const envPrefix = envParts.length > 0 ? `${envParts.join(" ")} ` : "";

    const startExec = await container.exec({
      Cmd: ["sh", "-c", `${envPrefix}bash /usr/local/bin/proxy.sh &`],
    });
    await startExec.start({ Detach: true });

    const deadline = Date.now() + PROXY_STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const checkExec = await container.exec({
          Cmd: ["sh", "-c", `nc -z 127.0.0.1 ${PROXY_PORT} 2>/dev/null`],
        });
        await checkExec.start({ Detach: true });
        let info = await checkExec.inspect();
        while (info.Running) {
          await new Promise((r) => setTimeout(r, 50));
          info = await checkExec.inspect();
        }
        if (info.ExitCode === 0) {
          return;
        }
      } catch {
        // Ignore, keep polling
      }
      await new Promise((r) => setTimeout(r, PROXY_POLL_INTERVAL_MS));
    }
    throw new Error("Proxy failed to start within timeout");
  }

  async setupIptables(container: Docker.Container): Promise<void> {
    if (this.network !== "filtered") {
      return;
    }

    const rules = [
      "/usr/sbin/iptables -A OUTPUT -o lo -j ACCEPT",
      "/usr/sbin/iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT",
      `/usr/sbin/iptables -A OUTPUT -p tcp -d 127.0.0.1 --dport ${PROXY_PORT} -m owner --uid-owner 100 -j ACCEPT`,
      "/usr/sbin/iptables -A OUTPUT -m owner --uid-owner 100 -j DROP",
    ].join(" && ");

    const exec = await container.exec({
      Cmd: ["sh", "-c", rules],
    });
    await exec.start({ Detach: true });

    let info = await exec.inspect();
    while (info.Running) {
      await new Promise((r) => setTimeout(r, 50));
      info = await exec.inspect();
    }

    if (info.ExitCode !== 0) {
      throw new Error(`Failed to set up iptables rules (exit code ${info.ExitCode})`);
    }

    logger.debug("[Filtered] iptables rules applied — sandbox user restricted to proxy only");
  }

  get proxyPort(): number {
    return PROXY_PORT;
  }
}
