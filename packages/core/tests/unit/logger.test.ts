import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { logger } from "../../src/utils/logger";

describe("Logger", () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  let logMock: ReturnType<typeof mock>;
  let warnMock: ReturnType<typeof mock>;
  let errorMock: ReturnType<typeof mock>;

  beforeEach(() => {
    logMock = mock();
    warnMock = mock();
    errorMock = mock();
    console.log = logMock;
    console.warn = warnMock;
    console.error = errorMock;
    // Reset to default state
    logger.setDebug(false);
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    logger.setDebug(false);
  });

  test("debug() does not print when debug mode is off", () => {
    logger.debug("should not appear");
    expect(logMock).not.toHaveBeenCalled();
  });

  test("debug() prints when debug mode is on", () => {
    logger.setDebug(true);
    logger.debug("visible message");
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith("[DEBUG]", "visible message");
  });

  test("debug() prints multiple arguments", () => {
    logger.setDebug(true);
    logger.debug("msg", 42, { key: "val" });
    expect(logMock).toHaveBeenCalledWith("[DEBUG]", "msg", 42, { key: "val" });
  });

  test("info() always prints regardless of debug mode", () => {
    logger.setDebug(false);
    logger.info("info message");
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith("info message");
  });

  test("warn() always prints regardless of debug mode", () => {
    logger.setDebug(false);
    logger.warn("warning");
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith("[WARN]", "warning");
  });

  test("error() always prints regardless of debug mode", () => {
    logger.setDebug(false);
    logger.error("error");
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock).toHaveBeenCalledWith("[ERROR]", "error");
  });

  test("setDebug() can toggle debug mode on and off", () => {
    logger.setDebug(true);
    logger.debug("on");
    expect(logMock).toHaveBeenCalledTimes(1);

    logMock.mockClear();

    logger.setDebug(false);
    logger.debug("off");
    expect(logMock).not.toHaveBeenCalled();
  });

  test("info(), warn(), error() print even when debug mode is on", () => {
    logger.setDebug(true);
    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(logMock).toHaveBeenCalledTimes(1); // only info (debug was not called)
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(errorMock).toHaveBeenCalledTimes(1);
  });
});
