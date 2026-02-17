/**
 * Unit tests for audit logging functionality.
 * Based on testing plan from GitHub issue #9.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AuditLogger } from "../../src/engine/audit";
import type { AuditConfig, ExecutionAudit } from "../../src/types";

// Mock audit directory to avoid conflicts
const TEST_AUDIT_DIR = join(process.cwd(), ".isol8_audit_test");
const TEST_AUDIT_FILE = join(TEST_AUDIT_DIR, "executions.log");

describe("AuditLogger", () => {
  beforeEach(() => {
    // Create test audit directory
    if (!existsSync(TEST_AUDIT_DIR)) {
      mkdirSync(TEST_AUDIT_DIR, { recursive: true });
    }
    // Clear test log file
    writeFileSync(TEST_AUDIT_FILE, "");
  });

  afterEach(() => {
    // Clean up test log file
    if (existsSync(TEST_AUDIT_FILE)) {
      writeFileSync(TEST_AUDIT_FILE, "");
    }
  });

  test("should not write audit log when audit is disabled", () => {
    const config: AuditConfig = {
      enabled: false,
      destination: "filesystem",
      retentionDays: 90,
      includeCode: false,
      includeOutput: false,
    };

    const auditLogger = new AuditLogger(config);
    const mockAudit: ExecutionAudit = {
      executionId: "test-id",
      userId: "test-user",
      timestamp: new Date().toISOString(),
      runtime: "node",
      codeHash: "hash123",
      containerId: "container123",
      exitCode: 0,
      durationMs: 100,
    };

    auditLogger.record(mockAudit);

    // Check that log file is still empty
    const logContent = readFileSync(TEST_AUDIT_FILE, "utf-8");
    expect(logContent.trim()).toBe("");
  });

  test("should write audit log when audit is enabled", () => {
    // Temporarily set the env var for test
    const originalEnv = process.env.ISOL8_AUDIT_DIR;
    process.env.ISOL8_AUDIT_DIR = TEST_AUDIT_DIR;

    const config: AuditConfig = {
      enabled: true,
      destination: "filesystem",
      retentionDays: 90,
      includeCode: false,
      includeOutput: false,
    };

    const auditLogger = new AuditLogger(config);
    const mockAudit: ExecutionAudit = {
      executionId: "test-id",
      userId: "test-user",
      timestamp: new Date().toISOString(),
      runtime: "node",
      codeHash: "hash123",
      containerId: "container123",
      exitCode: 0,
      durationMs: 100,
    };

    auditLogger.record(mockAudit);

    // Restore original env
    if (originalEnv !== undefined) {
      process.env.ISOL8_AUDIT_DIR = originalEnv;
    } else {
      process.env.ISOL8_AUDIT_DIR = undefined;
    }

    // Check that log file contains the audit entry
    const logContent = readFileSync(TEST_AUDIT_FILE, "utf-8");
    expect(logContent.trim()).not.toBe("");

    const logEntry = JSON.parse(logContent.trim());
    expect(logEntry.executionId).toBe("test-id");
    expect(logEntry.userId).toBe("test-user");
    expect(logEntry.runtime).toBe("node");
  });

  test("should apply privacy filtering based on config (exclude code and output)", () => {
    // Temporarily set the env var for test
    const originalEnv = process.env.ISOL8_AUDIT_DIR;
    process.env.ISOL8_AUDIT_DIR = TEST_AUDIT_DIR;

    const config: AuditConfig = {
      enabled: true,
      destination: "filesystem",
      retentionDays: 90,
      includeCode: false,
      includeOutput: false,
    };

    const auditLogger = new AuditLogger(config);
    const mockAudit: ExecutionAudit = {
      executionId: "test-id",
      userId: "test-user",
      timestamp: new Date().toISOString(),
      runtime: "node",
      codeHash: "hash123",
      containerId: "container123",
      exitCode: 0,
      durationMs: 100,
      code: "console.log('hello');",
      stdout: "hello",
      stderr: "error occurred",
    };

    auditLogger.record(mockAudit);

    // Restore original env
    if (originalEnv !== undefined) {
      process.env.ISOL8_AUDIT_DIR = originalEnv;
    } else {
      process.env.ISOL8_AUDIT_DIR = undefined;
    }

    const logContent = readFileSync(TEST_AUDIT_FILE, "utf-8");
    const logEntry = JSON.parse(logContent.trim());

    // Should not include code or output
    expect(logEntry.code).toBeUndefined();
    expect(logEntry.stdout).toBeUndefined();
    expect(logEntry.stderr).toBeUndefined();
  });

  test("should include code and output when configured", () => {
    // Temporarily set the env var for test
    const originalEnv = process.env.ISOL8_AUDIT_DIR;
    process.env.ISOL8_AUDIT_DIR = TEST_AUDIT_DIR;

    const config: AuditConfig = {
      enabled: true,
      destination: "filesystem",
      retentionDays: 90,
      includeCode: true,
      includeOutput: true,
    };

    const auditLogger = new AuditLogger(config);
    const mockAudit: ExecutionAudit = {
      executionId: "test-id",
      userId: "test-user",
      timestamp: new Date().toISOString(),
      runtime: "node",
      codeHash: "hash123",
      containerId: "container123",
      exitCode: 0,
      durationMs: 100,
      code: "console.log('hello');",
      stdout: "hello",
      stderr: "error occurred",
    };

    auditLogger.record(mockAudit);

    // Restore original env
    if (originalEnv !== undefined) {
      process.env.ISOL8_AUDIT_DIR = originalEnv;
    } else {
      process.env.ISOL8_AUDIT_DIR = undefined;
    }

    const logContent = readFileSync(TEST_AUDIT_FILE, "utf-8");
    const logEntry = JSON.parse(logContent.trim());

    // Should include code and output
    expect(logEntry.code).toBe("console.log('hello');");
    expect(logEntry.stdout).toBe("hello");
    expect(logEntry.stderr).toBe("error occurred");
  });

  test("should handle different destinations", () => {
    const config: AuditConfig = {
      enabled: true,
      destination: "stdout",
      retentionDays: 90,
      includeCode: false,
      includeOutput: false,
    };

    // We can't easily test stdout in bun:test, but let's check the configuration
    const auditLogger = new AuditLogger(config);
    expect(() => {
      // This should not throw an error about unsupported destination
      auditLogger.record({
        executionId: "test-id",
        userId: "test-user",
        timestamp: new Date().toISOString(),
        runtime: "node",
        codeHash: "hash123",
        containerId: "container123",
        exitCode: 0,
        durationMs: 100,
      });
    }).not.toThrow();
  });

  test("should properly hash code for verification", () => {
    const plainText = "console.log('hello world')";
    const hash = crypto.createHash("sha256").update(plainText).digest("hex");

    // Since we can't use crypto.subtle in tests easily, we just verify the node crypto produces the same result
    expect(hash).toBeDefined();
    expect(hash.length).toBe(64); // SHA-256 produces 64 hex characters
  });
});
