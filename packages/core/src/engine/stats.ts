/**
 * @module engine/stats
 *
 * Resource usage statistics collection from Docker containers.
 * Uses dockerode's container.stats() API to get CPU, memory, and network metrics.
 */

import type Docker from "dockerode";

/**
 * Resource usage metrics for a container execution.
 */
export interface ContainerResourceUsage {
  /** CPU usage as percentage (0-100 * num_cores) */
  cpuPercent: number;
  /** Current memory usage in megabytes */
  memoryMB: number;
  /** Peak memory usage in megabytes (if tracked) */
  peakMemoryMB?: number;
  /** Bytes received during execution */
  networkBytesIn: number;
  /** Bytes sent during execution */
  networkBytesOut: number;
}

/**
 * Docker stats response structure.
 */
interface DockerStats {
  read: string;
  precpu_stats: {
    cpu_usage: {
      total_usage: number;
      percpu_usage?: number[];
    };
    system_cpu_usage: number;
  };
  cpu_stats: {
    cpu_usage: {
      total_usage: number;
      percpu_usage?: number[];
    };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  memory_stats: {
    usage: number;
    max_usage?: number;
    limit: number;
    stats?: {
      cache?: number;
      rss?: number;
    };
  };
  networks?: Record<
    string,
    {
      rx_bytes: number;
      tx_bytes: number;
      rx_packets: number;
      tx_packets: number;
    }
  >;
}

/**
 * Calculate CPU percentage from docker stats.
 * Formula: (cpu_delta / system_delta) * num_cpus * 100
 */
function calculateCPUPercent(stats: DockerStats): number {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;

  if (systemDelta === 0 || cpuDelta === 0) {
    return 0;
  }

  const numCores =
    stats.cpu_stats.online_cpus ?? stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;

  return (cpuDelta / systemDelta) * numCores * 100;
}

/**
 * Extract network stats (sum across all interfaces).
 */
function calculateNetworkStats(stats: DockerStats): { in: number; out: number } {
  if (!stats.networks) {
    return { in: 0, out: 0 };
  }

  let rxBytes = 0;
  let txBytes = 0;

  for (const iface of Object.values(stats.networks)) {
    rxBytes += iface.rx_bytes;
    txBytes += iface.tx_bytes;
  }

  return { in: rxBytes, out: txBytes };
}

/**
 * Get resource usage snapshot for a container.
 *
 * @param container - Docker container instance
 * @returns Resource usage metrics
 */
export async function getContainerStats(
  container: Docker.Container
): Promise<ContainerResourceUsage> {
  // Get single stats snapshot (stream: false)
  const stats = (await container.stats({
    stream: false,
  })) as unknown as DockerStats;

  const cpuPercent = calculateCPUPercent(stats);
  const memoryBytes = stats.memory_stats.usage;
  const network = calculateNetworkStats(stats);

  return {
    cpuPercent: Math.round(cpuPercent * 100) / 100, // Round to 2 decimals
    memoryMB: Math.round(memoryBytes / (1024 * 1024)),
    networkBytesIn: network.in,
    networkBytesOut: network.out,
  };
}

/**
 * Calculate resource usage delta between two stat snapshots.
 * Useful for getting per-execution metrics.
 */
export function calculateResourceDelta(
  before: ContainerResourceUsage,
  after: ContainerResourceUsage
): ContainerResourceUsage {
  return {
    // CPU is already a rate, use the final value
    cpuPercent: after.cpuPercent,
    // Memory use final value
    memoryMB: after.memoryMB,
    // Network/Block I/O are cumulative, calculate delta
    networkBytesIn: after.networkBytesIn - before.networkBytesIn,
    networkBytesOut: after.networkBytesOut - before.networkBytesOut,
  };
}
