/**
 * Pluggable audit logger for execution provenance.
 *
 * Records ExecutionAudit objects to various destinations based on configuration.
 * Supports filesystem and stdout logging, with extensibility for cloud services.
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AuditConfig, ExecutionAudit } from "../types";
import { logger } from "../utils/logger";

export class AuditLogger {
  private readonly config: AuditConfig;
  private readonly auditFile: string;

  constructor(config: AuditConfig) {
    this.config = config;

    // Set up audit file path based on config
    const auditDir =
      config.logDir ?? process.env.ISOL8_AUDIT_DIR ?? join(process.cwd(), "./.isol8_audit");
    this.auditFile = join(auditDir, "executions.log");

    // Create audit directory if it doesn't exist
    if (!existsSync(auditDir)) {
      try {
        mkdirSync(auditDir, { recursive: true });
      } catch (err) {
        logger.error("Failed to create audit dir:", err);
      }
    }
  }

  /**
   * Record an audit entry based on the current configuration.
   */
  record(audit: ExecutionAudit): void {
    if (!this.config.enabled) {
      return; // Don't record if audit is disabled
    }

    try {
      // Apply privacy filtering based on config
      const filteredAudit = this.filterAuditData(audit);

      const line = `${JSON.stringify(filteredAudit)}\n`;

      switch (this.config.destination) {
        case "file":
        case "filesystem":
          appendFileSync(this.auditFile, line, { encoding: "utf-8" });
          break;
        case "stdout":
          console.log("AUDIT_LOG:", filteredAudit);
          break;
        default:
          // For other destinations, log an error
          logger.error(`Unsupported audit destination: ${this.config.destination}`);
          return;
      }

      logger.debug("Audit record written:", audit.executionId);

      // Run post-log script if configured
      if (this.config.postLogScript) {
        this.runPostLogScript();
      }
    } catch (err) {
      logger.error("Failed to write audit record:", err);
    }
  }

  /**
   * Run the configured post-log script.
   * The script receives the audit file path as its first argument.
   */
  private runPostLogScript(): void {
    if (!this.config.postLogScript) {
      return;
    }

    try {
      // Spawn script with file path as argument, detached so it doesn't block
      const child = spawn(this.config.postLogScript, [this.auditFile], {
        detached: true,
        stdio: "ignore",
      });

      child.on("error", (err) => {
        logger.error("Failed to run post-log script:", err);
      });

      // Unref so parent can exit without waiting for child
      child.unref();
    } catch (err) {
      logger.error("Failed to spawn post-log script:", err);
    }
  }

  /**
   * Apply privacy filtering to audit data based on configuration.
   */
  private filterAuditData(audit: ExecutionAudit): ExecutionAudit {
    // Start with required fields
    const result: ExecutionAudit = {
      executionId: audit.executionId,
      userId: audit.userId,
      timestamp: audit.timestamp,
      runtime: audit.runtime,
      codeHash: audit.codeHash,
      containerId: audit.containerId,
      exitCode: audit.exitCode,
      durationMs: audit.durationMs,
    };

    // Add optional fields if present
    if (audit.resourceUsage !== undefined) {
      result.resourceUsage = audit.resourceUsage;
    }
    if (audit.securityEvents !== undefined) {
      result.securityEvents = audit.securityEvents;
    }
    if (audit.metadata !== undefined) {
      result.metadata = audit.metadata;
    }

    // Conditionally add privacy-sensitive fields based on config
    if (this.config.includeCode && audit.code !== undefined) {
      (result as ExecutionAudit & { code?: string }).code = audit.code;
    }
    if (this.config.includeOutput) {
      if (audit.stdout !== undefined) {
        (result as ExecutionAudit & { stdout?: string }).stdout = audit.stdout;
      }
      if (audit.stderr !== undefined) {
        (result as ExecutionAudit & { stderr?: string }).stderr = audit.stderr;
      }
    }

    return result;
  }
}
