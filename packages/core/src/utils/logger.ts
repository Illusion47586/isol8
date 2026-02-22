/**
 * @module logger
 *
 * Centralized logging utility for isol8.
 * Supports debug mode toggling and standardized log formatting.
 */

class Logger {
  private debugMode = false;

  /**
   * Enable or disable debug logging.
   */
  setDebug(enabled: boolean) {
    this.debugMode = enabled;
  }

  /**
   * Log a debug message. Only prints if debug mode is enabled.
   */
  debug(...args: unknown[]) {
    if (this.debugMode) {
      console.log("[DEBUG]", ...args);
    }
  }

  /**
   * Log an info message. Always prints.
   */
  info(...args: unknown[]) {
    console.log(...args);
  }

  /**
   * Log a warning message. Always prints.
   */
  warn(...args: unknown[]) {
    console.warn("[WARN]", ...args);
  }

  /**
   * Log an error message. Always prints.
   */
  error(...args: unknown[]) {
    console.error("[ERROR]", ...args);
  }
}

export const logger = new Logger();
