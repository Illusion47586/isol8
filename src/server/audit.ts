/**
 * Simple pluggable audit logger for execution provenance.
 *
 * This module provides a very small abstraction that records ExecutionAudit
 * objects to a destination. Currently it supports a filesystem-based
 * append-only log (JSON lines). The implementation is intentionally small so
 * it can be extended to other destinations (S3, CloudWatch) later.
 */

import { join } from "node:path";

// Use Bun filesystem APIs when available (bun:fs), fallback to node:fs
let appendFileSync: typeof import("fs").appendFileSync;
let existsSync: typeof import("fs").existsSync;
let mkdirSync: typeof import("fs").mkdirSync;

try {
  // @ts-expect-error bun built-ins
  const bunFs = await import("bun:fs");
  appendFileSync = bunFs.appendFileSync;
  existsSync = bunFs.existsSync;
  mkdirSync = bunFs.mkdirSync;
} catch {
  const nodeFs = await import("node:fs");
  appendFileSync = nodeFs.appendFileSync;
  existsSync = nodeFs.existsSync;
  mkdirSync = nodeFs.mkdirSync;
}

import type { ExecutionAudit } from "../types";
import { logger } from "../utils/logger";

const AUDIT_DIR = process.env.ISOL8_AUDIT_DIR ?? join(process.cwd(), "./.isol8_audit");
const AUDIT_FILE = join(AUDIT_DIR, "executions.log");

if (!existsSync(AUDIT_DIR)) {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
  } catch (err) {
    logger.error("Failed to create audit dir:", err);
  }
}

export class AuditLogger {
  destination = AUDIT_FILE;

  record(audit: ExecutionAudit) {
    try {
      const line = `${JSON.stringify(audit)}\n`;
      appendFileSync(this.destination, line, { encoding: "utf-8" });
      logger.debug("Audit recorded:", audit.executionId);
    } catch (err) {
      logger.error("Failed to write audit record:", err);
    }
  }
}

export const auditLogger = new AuditLogger();
