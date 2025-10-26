import { test, expect } from "@playwright/test";
import {
  initV3Logger,
  getV3Logger,
  setV3Verbosity,
  bindInstanceLogger,
  unbindInstanceLogger,
  withInstanceLogContext,
  v3Logger,
} from "../logger";
import type { LogLine } from "../types/public/logs";

test.describe("V3 Logger Initialization", () => {
  test.beforeEach(async () => {
    // Note: Since the logger is a global singleton with cached initialization,
    // we can't fully reset it between tests. Tests should be written to be
    // independent and not rely on uninitialized state.
  });

  test("initV3Logger is idempotent and returns same promise", async () => {
    // Call init multiple times in rapid succession
    const promises = [
      initV3Logger({ verbose: 1, disablePino: true }),
      initV3Logger({ verbose: 2, disablePino: false }), // Different options should be ignored
      initV3Logger({ verbose: 0, disablePino: true }),
    ];

    // All promises should resolve successfully
    await Promise.all(promises);

    // Get the logger instance
    const logger = getV3Logger();
    expect(logger).toBeDefined();
    expect(logger.log).toBeDefined();
    expect(logger.setVerbosity).toBeDefined();
  });

  test("concurrent initV3Logger calls don't cause race conditions", async () => {
    // Simulate multiple V3 instances being created at the same time
    const concurrentInitCount = 10;
    const promises: Promise<void>[] = [];

    for (let i = 0; i < concurrentInitCount; i++) {
      promises.push(
        initV3Logger({
          verbose: (i % 3) as 0 | 1 | 2,
          disablePino: true,
        }),
      );
    }

    // All should complete without throwing
    await expect(Promise.all(promises)).resolves.toBeDefined();

    // Logger should be functional
    const logger = getV3Logger();
    expect(logger).toBeDefined();

    // Should be able to log without errors
    expect(() => {
      logger.log({
        category: "test",
        message: "Test message",
        level: 1,
      });
    }).not.toThrow();
  });

  test("logger works with disablePino: true (console fallback)", async () => {
    await initV3Logger({ verbose: 1, disablePino: true });
    const logger = getV3Logger();

    const testMessages: LogLine[] = [];
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;

    try {
      // Capture console output
      console.log = (...args: unknown[]) => {
        testMessages.push({
          category: "log",
          message: String(args[0]),
          level: 1,
        });
      };
      console.error = (...args: unknown[]) => {
        testMessages.push({
          category: "log",
          message: String(args[0]),
          level: 0,
        });
      };

      // Test different log levels
      logger.info("Info message", { key: "value" });
      logger.error("Error message", { error: "details" });
      logger.debug("Debug message");

      // Should have captured some output
      expect(testMessages.length).toBeGreaterThan(0);
    } finally {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    }
  });

  test("logger respects verbosity settings", async () => {
    await initV3Logger({ verbose: 1, disablePino: true });
    const logger = getV3Logger();

    const capturedLogs: string[] = [];
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;

    try {
      console.log = (msg: string) => {
        capturedLogs.push(msg);
      };
      console.error = (msg: string) => {
        capturedLogs.push(msg);
      };

      // Set verbosity to 1 (info only)
      setV3Verbosity(1);

      // Info should log (level 1 <= verbosity 1)
      logger.info("Info message");
      const infoCount = capturedLogs.length;

      // Debug should not log (level 2 > verbosity 1)
      logger.debug("Debug message");
      const afterDebugCount = capturedLogs.length;

      expect(afterDebugCount).toBe(infoCount);

      // Error should log (level 0 <= verbosity 1)
      logger.error("Error message");
      expect(capturedLogs.length).toBeGreaterThan(infoCount);
    } finally {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    }
  });

  test("logger handles auxiliary data correctly", async () => {
    await initV3Logger({ verbose: 2, disablePino: true });
    const logger = getV3Logger();

    const capturedLogs: string[] = [];
    const originalConsoleLog = console.log;

    try {
      console.log = (msg: string) => {
        capturedLogs.push(msg);
      };

      logger.log({
        category: "test",
        message: "Test with auxiliary",
        level: 1,
        auxiliary: {
          stringValue: { value: "test", type: "string" },
          integerValue: { value: "42", type: "integer" },
          booleanValue: { value: "true", type: "boolean" },
          objectValue: {
            value: JSON.stringify({ nested: "data" }),
            type: "object",
          },
        },
      });

      // Should have logged with auxiliary data
      expect(capturedLogs.length).toBeGreaterThan(0);
      const logOutput = capturedLogs.join("\n");
      expect(logOutput).toContain("Test with auxiliary");
      expect(logOutput).toContain("stringValue");
      expect(logOutput).toContain("integerValue");
    } finally {
      console.log = originalConsoleLog;
    }
  });

  test("logger initialization is thread-safe with Promise.race patterns", async () => {
    // This test simulates a common pattern where multiple async operations
    // race to initialize the logger
    const raceCount = 20;
    const results: boolean[] = [];

    for (let i = 0; i < raceCount; i++) {
      const result = await Promise.race([
        initV3Logger({ verbose: 1, disablePino: true }).then(() => true),
        initV3Logger({ verbose: 2, disablePino: true }).then(() => true),
        initV3Logger({ verbose: 0, disablePino: true }).then(() => true),
      ]);
      results.push(result);
    }

    // All races should complete successfully
    expect(results.every((r) => r === true)).toBe(true);
    expect(results.length).toBe(raceCount);

    // Logger should still be functional
    const logger = getV3Logger();
    expect(() => logger.info("Test after race")).not.toThrow();
  });

  test("logger handles rapid sequential initialization attempts", async () => {
    // Test the scenario where init is called multiple times in sequence
    // without awaiting (simulating fire-and-forget initialization)
    const sequentialCount = 15;

    // Don't await - let them execute in parallel
    const promises: Promise<void>[] = [];
    for (let i = 0; i < sequentialCount; i++) {
      promises.push(initV3Logger({ verbose: 1, disablePino: true }));
    }

    // All should complete without deadlock or error
    await expect(Promise.all(promises)).resolves.toBeDefined();

    // Logger should be usable
    const logger = getV3Logger();
    expect(() => {
      logger.log({
        category: "test",
        message: "After sequential init",
        level: 1,
      });
    }).not.toThrow();
  });

  test("logger methods don't throw on valid input", async () => {
    await initV3Logger({ verbose: 2, disablePino: true });
    const logger = getV3Logger();

    // Test all logger methods
    expect(() => {
      logger.error("Error message");
      logger.error("Error with data", { code: 500 });
      logger.info("Info message");
      logger.info("Info with data", { status: "ok" });
      logger.debug("Debug message");
      logger.debug("Debug with data", { trace: "details" });
      logger.log({
        category: "custom",
        message: "Custom log",
        level: 1,
        timestamp: new Date().toISOString(),
      });
    }).not.toThrow();
  });

  test("logger filters undefined and empty values from auxiliary data", async () => {
    await initV3Logger({ verbose: 2, disablePino: true });
    const logger = getV3Logger();

    const capturedLogs: string[] = [];
    const originalConsoleLog = console.log;

    try {
      console.log = (msg: string) => {
        capturedLogs.push(msg);
      };

      logger.info("Test message", {
        definedValue: "present",
        undefinedValue: undefined,
        emptyObject: {},
        emptyArray: [],
        nullValue: null,
      });

      const logOutput = capturedLogs.join("\n");
      expect(logOutput).toContain("definedValue");
      expect(logOutput).not.toContain("undefinedValue");
      expect(logOutput).not.toContain("emptyObject");
      expect(logOutput).not.toContain("emptyArray");
    } finally {
      console.log = originalConsoleLog;
    }
  });
});

test.describe("V3 Logger Instance Binding", () => {
  test.afterEach(() => {
    // Clean up any bound instance loggers
    // Note: We can't easily enumerate all instances, so tests should clean up
    // their own bindings
  });

  test("bindInstanceLogger and unbindInstanceLogger work correctly", async () => {
    await initV3Logger({ verbose: 1, disablePino: true });

    const instanceId = "test-instance-001";
    const capturedLogs: LogLine[] = [];

    const instanceLogger = (line: LogLine) => {
      capturedLogs.push(line);
    };

    // Bind the instance logger
    bindInstanceLogger(instanceId, instanceLogger);

    // Log within context
    withInstanceLogContext(instanceId, () => {
      v3Logger({
        category: "test",
        message: "Test message for instance",
        level: 1,
      });
    });

    // Should have captured the log
    expect(capturedLogs.length).toBe(1);
    expect(capturedLogs[0].message).toBe("Test message for instance");
    expect(capturedLogs[0].auxiliary?.instanceId?.value).toBe(instanceId);

    // Unbind the logger
    unbindInstanceLogger(instanceId);

    // Log again - should not be captured by instance logger
    const beforeCount = capturedLogs.length;
    withInstanceLogContext(instanceId, () => {
      v3Logger({
        category: "test",
        message: "After unbind",
        level: 1,
      });
    });

    // Should not have captured the second log
    expect(capturedLogs.length).toBe(beforeCount);
  });

  test("multiple instances have isolated log routing", async () => {
    await initV3Logger({ verbose: 1, disablePino: true });

    const instance1Id = "test-instance-1";
    const instance2Id = "test-instance-2";
    const instance1Logs: LogLine[] = [];
    const instance2Logs: LogLine[] = [];

    bindInstanceLogger(instance1Id, (line) => instance1Logs.push(line));
    bindInstanceLogger(instance2Id, (line) => instance2Logs.push(line));

    try {
      // Log from instance 1
      withInstanceLogContext(instance1Id, () => {
        v3Logger({
          category: "test",
          message: "From instance 1",
          level: 1,
        });
      });

      // Log from instance 2
      withInstanceLogContext(instance2Id, () => {
        v3Logger({
          category: "test",
          message: "From instance 2",
          level: 1,
        });
      });

      // Each instance should have only its own log
      expect(instance1Logs.length).toBe(1);
      expect(instance2Logs.length).toBe(1);
      expect(instance1Logs[0].message).toBe("From instance 1");
      expect(instance2Logs[0].message).toBe("From instance 2");
      expect(instance1Logs[0].auxiliary?.instanceId?.value).toBe(instance1Id);
      expect(instance2Logs[0].auxiliary?.instanceId?.value).toBe(instance2Id);
    } finally {
      unbindInstanceLogger(instance1Id);
      unbindInstanceLogger(instance2Id);
    }
  });

  test("v3Logger falls back to global logger when no instance context", async () => {
    await initV3Logger({ verbose: 1, disablePino: true });

    const capturedLogs: string[] = [];
    const originalConsoleLog = console.log;

    try {
      console.log = (msg: string) => {
        capturedLogs.push(msg);
      };

      // Log without any instance context
      v3Logger({
        category: "test",
        message: "Global log without context",
        level: 1,
      });

      // Should have used global console logger
      expect(capturedLogs.length).toBeGreaterThan(0);
      const logOutput = capturedLogs.join("\n");
      expect(logOutput).toContain("Global log without context");
    } finally {
      console.log = originalConsoleLog;
    }
  });

  test("instance logger errors don't break logging", async () => {
    await initV3Logger({ verbose: 1, disablePino: true });

    const instanceId = "failing-instance";
    const capturedGlobalLogs: string[] = [];
    const originalConsoleLog = console.log;

    try {
      console.log = (msg: string) => {
        capturedGlobalLogs.push(msg);
      };

      // Bind a logger that throws
      bindInstanceLogger(instanceId, () => {
        throw new Error("Instance logger failed");
      });

      // Should fall back to global logger when instance logger throws
      withInstanceLogContext(instanceId, () => {
        expect(() => {
          v3Logger({
            category: "test",
            message: "Test with failing instance logger",
            level: 1,
          });
        }).not.toThrow();
      });

      // Global logger should have received the log as fallback
      expect(capturedGlobalLogs.length).toBeGreaterThan(0);
    } finally {
      console.log = originalConsoleLog;
      unbindInstanceLogger(instanceId);
    }
  });

  test("withInstanceLogContext nests properly", async () => {
    await initV3Logger({ verbose: 1, disablePino: true });

    const outerInstanceId = "outer-instance";
    const innerInstanceId = "inner-instance";
    const outerLogs: LogLine[] = [];
    const innerLogs: LogLine[] = [];

    bindInstanceLogger(outerInstanceId, (line) => outerLogs.push(line));
    bindInstanceLogger(innerInstanceId, (line) => innerLogs.push(line));

    try {
      withInstanceLogContext(outerInstanceId, () => {
        v3Logger({
          category: "test",
          message: "Outer context",
          level: 1,
        });

        withInstanceLogContext(innerInstanceId, () => {
          v3Logger({
            category: "test",
            message: "Inner context",
            level: 1,
          });
        });

        v3Logger({
          category: "test",
          message: "Back to outer context",
          level: 1,
        });
      });

      // Outer instance should have 2 logs
      expect(outerLogs.length).toBe(2);
      expect(outerLogs[0].message).toBe("Outer context");
      expect(outerLogs[1].message).toBe("Back to outer context");

      // Inner instance should have 1 log
      expect(innerLogs.length).toBe(1);
      expect(innerLogs[0].message).toBe("Inner context");
    } finally {
      unbindInstanceLogger(outerInstanceId);
      unbindInstanceLogger(innerInstanceId);
    }
  });

  test("withInstanceLogContext returns function result", async () => {
    await initV3Logger({ verbose: 1, disablePino: true });

    const instanceId = "return-test-instance";
    bindInstanceLogger(instanceId, () => {});

    try {
      const result = withInstanceLogContext(instanceId, () => {
        return { success: true, value: 42 };
      });

      expect(result).toEqual({ success: true, value: 42 });

      // Test with async function
      const asyncResult = await withInstanceLogContext(instanceId, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "async result";
      });

      expect(asyncResult).toBe("async result");
    } finally {
      unbindInstanceLogger(instanceId);
    }
  });
});
