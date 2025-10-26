import { test, expect } from "@playwright/test";
import {
  bindInstanceLogger,
  unbindInstanceLogger,
  withInstanceLogContext,
  v3Logger,
} from "../logger";
import type { LogLine } from "../types/public/logs";

test.describe("V3 Logger Instance Routing", () => {
  test.afterEach(() => {
    // Clean up is handled by unbindInstanceLogger calls in tests
  });

  test("bindInstanceLogger routes logs to correct instance", () => {
    const instanceId = "test-instance-001";
    const capturedLogs: LogLine[] = [];

    bindInstanceLogger(instanceId, (line) => {
      capturedLogs.push(line);
    });

    try {
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
    } finally {
      unbindInstanceLogger(instanceId);
    }
  });

  test("unbindInstanceLogger stops routing", () => {
    const instanceId = "test-instance-002";
    const capturedLogs: LogLine[] = [];
    const consoleOutput: string[] = [];
    const originalConsoleLog = console.log;

    try {
      console.log = (msg: string) => {
        consoleOutput.push(msg);
      };

      bindInstanceLogger(instanceId, (line) => {
        capturedLogs.push(line);
      });

      // Unbind immediately
      unbindInstanceLogger(instanceId);

      // Log - should fall back to console
      withInstanceLogContext(instanceId, () => {
        v3Logger({
          category: "test",
          message: "After unbind",
          level: 1,
        });
      });

      // Should not have captured via instance logger
      expect(capturedLogs.length).toBe(0);
      // But should have logged to console
      expect(consoleOutput.length).toBeGreaterThan(0);
    } finally {
      console.log = originalConsoleLog;
      unbindInstanceLogger(instanceId);
    }
  });

  test("multiple instances have isolated log routing", () => {
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
    } finally {
      unbindInstanceLogger(instance1Id);
      unbindInstanceLogger(instance2Id);
    }
  });

  test("v3Logger falls back to console when no instance context", () => {
    const capturedLogs: string[] = [];
    const originalConsoleLog = console.log;

    try {
      console.log = (msg: string) => {
        capturedLogs.push(msg);
      };

      // Log without any instance context
      v3Logger({
        category: "test",
        message: "Console fallback log",
        level: 1,
      });

      // Should have used console logger
      expect(capturedLogs.length).toBeGreaterThan(0);
      const logOutput = capturedLogs.join("\n");
      expect(logOutput).toContain("Console fallback log");
    } finally {
      console.log = originalConsoleLog;
    }
  });

  test("v3Logger falls back to console when instance logger throws", () => {
    const instanceId = "failing-instance";
    const capturedConsoleLogs: string[] = [];
    const originalConsoleLog = console.log;

    try {
      console.log = (msg: string) => {
        capturedConsoleLogs.push(msg);
      };

      // Bind a logger that throws
      bindInstanceLogger(instanceId, () => {
        throw new Error("Instance logger failed");
      });

      // Should fall back to console without throwing
      withInstanceLogContext(instanceId, () => {
        expect(() => {
          v3Logger({
            category: "test",
            message: "Test with failing instance logger",
            level: 1,
          });
        }).not.toThrow();
      });

      // Console should have received the log as fallback
      expect(capturedConsoleLogs.length).toBeGreaterThan(0);
      const logOutput = capturedConsoleLogs.join("\n");
      expect(logOutput).toContain("Test with failing instance logger");
    } finally {
      console.log = originalConsoleLog;
      unbindInstanceLogger(instanceId);
    }
  });

  test("withInstanceLogContext nests properly", () => {
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

  test("withInstanceLogContext returns function result", () => {
    const instanceId = "return-test-instance";
    bindInstanceLogger(instanceId, () => {});

    try {
      const result = withInstanceLogContext(instanceId, () => {
        return { success: true, value: 42 };
      });

      expect(result).toEqual({ success: true, value: 42 });
    } finally {
      unbindInstanceLogger(instanceId);
    }
  });

  test("withInstanceLogContext works with async functions", async () => {
    const instanceId = "async-test-instance";
    const capturedLogs: LogLine[] = [];

    bindInstanceLogger(instanceId, (line) => capturedLogs.push(line));

    try {
      const asyncResult = await withInstanceLogContext(instanceId, async () => {
        v3Logger({
          category: "test",
          message: "Log from async context",
          level: 1,
        });

        await new Promise((resolve) => setTimeout(resolve, 10));

        v3Logger({
          category: "test",
          message: "Log after await",
          level: 1,
        });

        return "async result";
      });

      expect(asyncResult).toBe("async result");
      expect(capturedLogs.length).toBe(2);
      expect(capturedLogs[0].message).toBe("Log from async context");
      expect(capturedLogs[1].message).toBe("Log after await");
    } finally {
      unbindInstanceLogger(instanceId);
    }
  });

  test("console fallback formats different log levels correctly", () => {
    const consoleOutput: { level: string; msg: string }[] = [];
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleDebug = console.debug;

    try {
      console.log = (msg: string) => {
        consoleOutput.push({ level: "log", msg });
      };
      console.error = (msg: string) => {
        consoleOutput.push({ level: "error", msg });
      };
      console.debug = (msg: string) => {
        consoleOutput.push({ level: "debug", msg });
      };

      // Test error level (0)
      v3Logger({
        category: "test",
        message: "Error message",
        level: 0,
      });

      // Test info level (1)
      v3Logger({
        category: "test",
        message: "Info message",
        level: 1,
      });

      // Test debug level (2)
      v3Logger({
        category: "test",
        message: "Debug message",
        level: 2,
      });

      expect(consoleOutput.length).toBe(3);
      expect(consoleOutput[0].level).toBe("error");
      expect(consoleOutput[0].msg).toContain("ERROR");
      expect(consoleOutput[0].msg).toContain("Error message");

      expect(consoleOutput[1].level).toBe("log");
      expect(consoleOutput[1].msg).toContain("INFO");
      expect(consoleOutput[1].msg).toContain("Info message");

      expect(consoleOutput[2].level).toBe("debug");
      expect(consoleOutput[2].msg).toContain("DEBUG");
      expect(consoleOutput[2].msg).toContain("Debug message");
    } finally {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      console.debug = originalConsoleDebug;
    }
  });

  test("console fallback formats auxiliary data", () => {
    const consoleOutput: string[] = [];
    const originalConsoleLog = console.log;

    try {
      console.log = (msg: string) => {
        consoleOutput.push(msg);
      };

      v3Logger({
        category: "test",
        message: "Message with auxiliary",
        level: 1,
        auxiliary: {
          stringValue: { value: "test", type: "string" },
          integerValue: { value: "42", type: "integer" },
          objectValue: {
            value: JSON.stringify({ nested: "data" }),
            type: "object",
          },
        },
      });

      expect(consoleOutput.length).toBe(1);
      const output = consoleOutput[0];
      expect(output).toContain("Message with auxiliary");
      expect(output).toContain("stringValue");
      expect(output).toContain("integerValue");
      expect(output).toContain("objectValue");
    } finally {
      console.log = originalConsoleLog;
    }
  });

  test("concurrent instances don't interfere", () => {
    const instances = Array.from({ length: 10 }, (_, i) => `instance-${i}`);
    const logsByInstance = new Map<string, LogLine[]>();

    // Bind all instances
    instances.forEach((id) => {
      const logs: LogLine[] = [];
      logsByInstance.set(id, logs);
      bindInstanceLogger(id, (line) => logs.push(line));
    });

    try {
      // Log from each instance
      instances.forEach((id, index) => {
        withInstanceLogContext(id, () => {
          v3Logger({
            category: "test",
            message: `Message from ${id}`,
            level: 1,
            auxiliary: {
              index: { value: String(index), type: "integer" },
            },
          });
        });
      });

      // Verify each instance received only its own log
      instances.forEach((id) => {
        const logs = logsByInstance.get(id)!;
        expect(logs.length).toBe(1);
        expect(logs[0].message).toBe(`Message from ${id}`);
      });
    } finally {
      instances.forEach((id) => unbindInstanceLogger(id));
    }
  });
});

test.describe("V3 Logger with External Logger (Production Pattern)", () => {
  test.afterEach(() => {
    // Clean up instance loggers
  });

  test("external logger receives all logs from v3Logger", () => {
    const instanceId = "v3-instance-with-external";
    const externalLogs: LogLine[] = [];

    // Simulate V3 constructor behavior with external logger
    const externalLogger = (line: LogLine) => {
      externalLogs.push(line);
    };

    bindInstanceLogger(instanceId, externalLogger);

    try {
      withInstanceLogContext(instanceId, () => {
        v3Logger({
          category: "a11y/snapshot",
          message: "Capturing hybrid snapshot",
          level: 0,
        });

        v3Logger({
          category: "handlers/act",
          message: "Executing action",
          level: 1,
          auxiliary: {
            action: { value: "click", type: "string" },
          },
        });

        v3Logger({
          category: "debug",
          message: "Debug details",
          level: 2,
        });
      });

      // All logs should be captured by external logger
      expect(externalLogs.length).toBe(3);
      expect(externalLogs[0].message).toBe("Capturing hybrid snapshot");
      expect(externalLogs[1].message).toBe("Executing action");
      expect(externalLogs[2].message).toBe("Debug details");
    } finally {
      unbindInstanceLogger(instanceId);
    }
  });

  test("StagehandLogger wrapper forwards to external logger", () => {
    const instanceId = "v3-with-stagehand-wrapper";
    const externalLogs: LogLine[] = [];

    // Simulate V3's stagehandLogger.log() wrapping pattern
    const mockStagehandLogger = {
      log: (line: LogLine) => {
        // This simulates StagehandLogger.log() which internally calls externalLogger
        externalLogs.push(line);
      },
    };

    bindInstanceLogger(instanceId, (line) => mockStagehandLogger.log(line));

    try {
      withInstanceLogContext(instanceId, () => {
        v3Logger({
          category: "test",
          message: "Log through StagehandLogger wrapper",
          level: 1,
        });
      });

      expect(externalLogs.length).toBe(1);
      expect(externalLogs[0].message).toBe(
        "Log through StagehandLogger wrapper",
      );
    } finally {
      unbindInstanceLogger(instanceId);
    }
  });

  test("multiple V3 instances with different external loggers", () => {
    const instance1Id = "v3-instance-1";
    const instance2Id = "v3-instance-2";
    const external1Logs: LogLine[] = [];
    const external2Logs: LogLine[] = [];

    // Simulate two V3 instances with different external loggers
    bindInstanceLogger(instance1Id, (line) => external1Logs.push(line));
    bindInstanceLogger(instance2Id, (line) => external2Logs.push(line));

    try {
      // Instance 1 logs
      withInstanceLogContext(instance1Id, () => {
        v3Logger({
          category: "instance1",
          message: "Instance 1 activity",
          level: 1,
        });
      });

      // Instance 2 logs
      withInstanceLogContext(instance2Id, () => {
        v3Logger({
          category: "instance2",
          message: "Instance 2 activity",
          level: 1,
        });
      });

      // Each external logger should only have its instance's logs
      expect(external1Logs.length).toBe(1);
      expect(external2Logs.length).toBe(1);
      expect(external1Logs[0].message).toBe("Instance 1 activity");
      expect(external2Logs[0].message).toBe("Instance 2 activity");
    } finally {
      unbindInstanceLogger(instance1Id);
      unbindInstanceLogger(instance2Id);
    }
  });

  test("external logger receives logs with auxiliary data preserved", () => {
    const instanceId = "v3-with-auxiliary";
    const externalLogs: LogLine[] = [];

    bindInstanceLogger(instanceId, (line) => externalLogs.push(line));

    try {
      withInstanceLogContext(instanceId, () => {
        v3Logger({
          category: "extract",
          message: "Extracting data",
          level: 1,
          auxiliary: {
            selector: { value: "xpath=/html/body", type: "string" },
            timeout: { value: "5000", type: "integer" },
            retries: { value: "3", type: "integer" },
            metadata: {
              value: JSON.stringify({ key: "value" }),
              type: "object",
            },
          },
        });
      });

      expect(externalLogs.length).toBe(1);
      const log = externalLogs[0];
      expect(log.auxiliary).toBeDefined();
      expect(log.auxiliary?.selector?.value).toBe("xpath=/html/body");
      expect(log.auxiliary?.timeout?.value).toBe("5000");
      expect(log.auxiliary?.retries?.value).toBe("3");
      expect(log.auxiliary?.metadata?.type).toBe("object");
    } finally {
      unbindInstanceLogger(instanceId);
    }
  });

  test("external logger handles rapid concurrent logs", () => {
    const instanceId = "v3-rapid-logs";
    const externalLogs: LogLine[] = [];

    bindInstanceLogger(instanceId, (line) => externalLogs.push(line));

    try {
      withInstanceLogContext(instanceId, () => {
        // Simulate rapid logging like during snapshot capture
        for (let i = 0; i < 50; i++) {
          v3Logger({
            category: "perf",
            message: `Operation ${i}`,
            level: 2,
            auxiliary: {
              iteration: { value: String(i), type: "integer" },
            },
          });
        }
      });

      // All logs should be captured
      expect(externalLogs.length).toBe(50);
      expect(externalLogs[0].message).toBe("Operation 0");
      expect(externalLogs[49].message).toBe("Operation 49");
    } finally {
      unbindInstanceLogger(instanceId);
    }
  });

  test("external logger can filter by log level", () => {
    const instanceId = "v3-with-filtering";
    const errorLogs: LogLine[] = [];

    // External logger that only captures errors
    const filteringLogger = (line: LogLine) => {
      if (line.level === 0) {
        errorLogs.push(line);
      }
    };

    bindInstanceLogger(instanceId, filteringLogger);

    try {
      withInstanceLogContext(instanceId, () => {
        v3Logger({
          category: "test",
          message: "Info message",
          level: 1,
        });

        v3Logger({
          category: "test",
          message: "Error message",
          level: 0,
        });

        v3Logger({
          category: "test",
          message: "Debug message",
          level: 2,
        });

        v3Logger({
          category: "test",
          message: "Another error",
          level: 0,
        });
      });

      // Only error logs should be captured
      expect(errorLogs.length).toBe(2);
      expect(errorLogs[0].message).toBe("Error message");
      expect(errorLogs[1].message).toBe("Another error");
    } finally {
      unbindInstanceLogger(instanceId);
    }
  });

  test("external logger persists across async operations", async () => {
    const instanceId = "v3-async-ops";
    const externalLogs: LogLine[] = [];

    bindInstanceLogger(instanceId, (line) => externalLogs.push(line));

    try {
      await withInstanceLogContext(instanceId, async () => {
        v3Logger({
          category: "async",
          message: "Before async operation",
          level: 1,
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        v3Logger({
          category: "async",
          message: "After async operation",
          level: 1,
        });

        await Promise.all([
          Promise.resolve().then(() =>
            v3Logger({
              category: "async",
              message: "Parallel operation 1",
              level: 1,
            }),
          ),
          Promise.resolve().then(() =>
            v3Logger({
              category: "async",
              message: "Parallel operation 2",
              level: 1,
            }),
          ),
        ]);
      });

      // All logs should be captured despite async boundaries
      expect(externalLogs.length).toBe(4);
      expect(externalLogs[0].message).toBe("Before async operation");
      expect(externalLogs[1].message).toBe("After async operation");
    } finally {
      unbindInstanceLogger(instanceId);
    }
  });
});
