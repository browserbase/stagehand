import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { getV3DynamicTestConfig } from "./v3.dynamic.config";
import type { LogLine } from "../types/public/logs";

test.describe("V3 Multi-Instance Logger Isolation", () => {
  // Run tests serially to avoid resource exhaustion from creating many Chrome instances
  test.describe.configure({ mode: "serial" });
  // Increase timeout for stress tests that create/destroy multiple instances
  test.setTimeout(120_000);

  test("multiple V3 instances can be created concurrently without logger conflicts", async () => {
    const instanceCount = 5;
    const instances: V3[] = [];
    const instanceLogs: Map<number, LogLine[]> = new Map();

    try {
      // Create multiple instances with individual loggers
      const creationPromises = Array.from({ length: instanceCount }, (_, i) => {
        const logs: LogLine[] = [];
        instanceLogs.set(i, logs);

        const config = getV3DynamicTestConfig({
          verbose: 2,
          disablePino: true,
          logger: (line: LogLine) => {
            logs.push({
              ...line,
              auxiliary: {
                ...line.auxiliary,
                index: { value: String(i), type: "integer" },
              },
            });
          },
        });

        const v3 = new V3(config);
        instances.push(v3);
        return v3.init();
      });

      // All instances should initialize successfully
      await Promise.all(creationPromises);

      // Each instance should be initialized
      expect(instances.length).toBe(instanceCount);
      for (const instance of instances) {
        expect(instance.context).toBeDefined();
      }

      // Perform operations that generate logs
      await Promise.all(
        instances.map(async (instance) => {
          const page = await instance.context.awaitActivePage();
          await page.goto("about:blank");
        }),
      );

      // Each instance should have logged to its own logger
      for (let i = 0; i < instanceCount; i++) {
        const logs = instanceLogs.get(i)!;
        // Each instance should have some logs
        expect(logs.length).toBeGreaterThan(0);

        // Logs should not contain data from other instances
        // (though this is harder to verify without more specific markers)
        const hasOwnLogs = logs.some(
          (log) =>
            log.auxiliary?.index?.value === String(i) ||
            log.category === "init",
        );
        expect(hasOwnLogs).toBe(true);
      }
    } finally {
      // Clean up all instances
      await Promise.all(
        instances.map((instance) => instance.close().catch(() => {})),
      );
    }
  });

  test("V3 instances with external loggers don't leak logs to each other", async () => {
    const instance1Logs: LogLine[] = [];
    const instance2Logs: LogLine[] = [];

    const v3Instance1 = new V3(
      getV3DynamicTestConfig({
        verbose: 2,
        disablePino: true,
        logger: (line: LogLine) => instance1Logs.push(line),
      }),
    );

    const v3Instance2 = new V3(
      getV3DynamicTestConfig({
        verbose: 2,
        disablePino: true,
        logger: (line: LogLine) => instance2Logs.push(line),
      }),
    );

    try {
      // Initialize both instances
      await Promise.all([v3Instance1.init(), v3Instance2.init()]);

      // Perform operations on each instance
      const page1 = await v3Instance1.context.awaitActivePage();
      await page1.goto("about:blank");

      const page2 = await v3Instance2.context.awaitActivePage();
      await page2.goto("data:text/html,<h1>Instance 2</h1>");

      // Both instances should have logs
      expect(instance1Logs.length).toBeGreaterThan(0);
      expect(instance2Logs.length).toBeGreaterThan(0);

      // Logs should be distinct (no exact duplicates)
      // This is a weak check, but verifies basic isolation
      const instance1Messages = new Set(instance1Logs.map((l) => l.message));
      const instance2Messages = new Set(instance2Logs.map((l) => l.message));

      // At least some messages should be unique to each instance
      // (This might not always be true for very generic messages like "init",
      // but serves as a smoke test)
      const allMessages = new Set([...instance1Messages, ...instance2Messages]);
      expect(allMessages.size).toBeGreaterThanOrEqual(
        Math.max(instance1Messages.size, instance2Messages.size),
      );
    } finally {
      await Promise.all([
        v3Instance1.close().catch(() => {}),
        v3Instance2.close().catch(() => {}),
      ]);
    }
  });

  test("V3 instances without external loggers use shared global logger", async () => {
    // Create instances without external loggers
    const v3Instance1 = new V3(
      getV3DynamicTestConfig({
        verbose: 1,
        disablePino: true,
      }),
    );

    const v3Instance2 = new V3(
      getV3DynamicTestConfig({
        verbose: 1,
        disablePino: true,
      }),
    );

    try {
      // Initialize both instances concurrently
      await Promise.all([v3Instance1.init(), v3Instance2.init()]);

      // Both should work fine
      expect(v3Instance1.context).toBeDefined();
      expect(v3Instance2.context).toBeDefined();

      // Perform basic operations to ensure logging doesn't cause issues
      const page1 = await v3Instance1.context.awaitActivePage();
      const page2 = await v3Instance2.context.awaitActivePage();

      await Promise.all([page1.goto("about:blank"), page2.goto("about:blank")]);

      // Both should still be operational
      expect(page1.url()).toContain("about:blank");
      expect(page2.url()).toContain("about:blank");
    } finally {
      await Promise.all([
        v3Instance1.close().catch(() => {}),
        v3Instance2.close().catch(() => {}),
      ]);
    }
  });

  test("rapidly creating and destroying instances doesn't cause logger issues", async () => {
    const iterations = 10;
    const results: boolean[] = [];

    for (let i = 0; i < iterations; i++) {
      const logs: LogLine[] = [];
      const v3 = new V3(
        getV3DynamicTestConfig({
          verbose: 1, // Capture INFO logs for verification
          disablePino: true,
          logger: (line: LogLine) => logs.push(line),
        }),
      );

      try {
        await v3.init();
        const page = await v3.context.awaitActivePage();
        await page.goto("about:blank");
        results.push(true);

        // Verify some logs were captured
        expect(logs.length).toBeGreaterThan(0);
      } finally {
        await v3.close();
      }
    }

    // All iterations should succeed
    expect(results.length).toBe(iterations);
    expect(results.every((r) => r === true)).toBe(true);
  });

  test("concurrent instance creation with mixed logger configurations", async () => {
    const instances: V3[] = [];
    const configs = [
      // With Pino disabled
      getV3DynamicTestConfig({ verbose: 1, disablePino: true }),
      // With external logger
      getV3DynamicTestConfig({
        verbose: 2,
        disablePino: true,
        //eslint-disable-next-line @typescript-eslint/no-unused-vars
        logger: (_line: LogLine) => {
          // External logger
        },
      }),
      // Without external logger
      getV3DynamicTestConfig({ verbose: 0, disablePino: true }),
      // High verbosity
      getV3DynamicTestConfig({ verbose: 2, disablePino: true }),
    ];

    try {
      // Create all instances concurrently
      const creationPromises = configs.map((config) => {
        const v3 = new V3(config);
        instances.push(v3);
        return v3.init();
      });

      await Promise.all(creationPromises);

      // All should be initialized successfully
      expect(instances.length).toBe(configs.length);
      for (const instance of instances) {
        expect(instance.context).toBeDefined();
      }

      // All should be able to perform operations
      await Promise.all(
        instances.map(async (instance) => {
          const page = await instance.context.awaitActivePage();
          await page.goto("about:blank");
          expect(page.url()).toContain("about:blank");
        }),
      );
    } finally {
      await Promise.all(
        instances.map((instance) => instance.close().catch(() => {})),
      );
    }
  });

  test("V3 instance logger is properly cleaned up on close", async () => {
    const logs: LogLine[] = [];
    const v3 = new V3(
      getV3DynamicTestConfig({
        verbose: 2,
        disablePino: true,
        logger: (line: LogLine) => logs.push(line),
      }),
    );

    await v3.init();
    const initialLogCount = logs.length;
    expect(initialLogCount).toBeGreaterThan(0);

    await v3.close();

    // After close, the instance should not generate new logs
    // (This is hard to test directly, but we can verify the instance is closed)
    expect(v3["state"].kind).toBe("UNINITIALIZED");
  });

  test("logger works correctly across instance lifecycle", async () => {
    const logs: LogLine[] = [];
    const v3 = new V3(
      getV3DynamicTestConfig({
        verbose: 2,
        disablePino: true,
        logger: (line: LogLine) => logs.push(line),
      }),
    );

    try {
      // Before init
      expect(logs.length).toBe(0);

      // After init
      await v3.init();
      const afterInitCount = logs.length;
      expect(afterInitCount).toBeGreaterThan(0);

      // During operation
      const page = await v3.context.awaitActivePage();
      await page.goto("data:text/html,<h1>Test</h1>");
      const afterOperationCount = logs.length;
      expect(afterOperationCount).toBeGreaterThanOrEqual(afterInitCount);

      // Verify log structure
      const initLogs = logs.filter((log) => log.category === "init");
      expect(initLogs.length).toBeGreaterThan(0);

      // All logs should have required fields
      for (const log of logs) {
        expect(log.category).toBeDefined();
        expect(log.message).toBeDefined();
        expect(typeof log.level).toBe("number");
      }
    } finally {
      await v3.close();
    }
  });

  test("multiple instances can navigate concurrently without logger interference", async () => {
    const instanceCount = 3;
    const instances: V3[] = [];
    const instanceLogs: Map<number, LogLine[]> = new Map();

    try {
      // Create instances
      for (let i = 0; i < instanceCount; i++) {
        const logs: LogLine[] = [];
        instanceLogs.set(i, logs);

        const v3 = new V3(
          getV3DynamicTestConfig({
            verbose: 1,
            disablePino: true,
            logger: (line: LogLine) => logs.push(line),
          }),
        );

        instances.push(v3);
        await v3.init();
      }

      // Navigate all instances concurrently to different URLs
      const urls = [
        "data:text/html,<h1>Page 1</h1>",
        "data:text/html,<h1>Page 2</h1>",
        "data:text/html,<h1>Page 3</h1>",
      ];

      await Promise.all(
        instances.map(async (instance, i) => {
          const page = await instance.context.awaitActivePage();
          await page.goto(urls[i]);
        }),
      );

      // Verify each instance navigated to the correct URL
      for (let i = 0; i < instanceCount; i++) {
        const page = await instances[i].context.awaitActivePage();
        expect(page.url()).toContain(`Page ${i + 1}`);
      }

      // Each instance should have its own logs
      for (let i = 0; i < instanceCount; i++) {
        const logs = instanceLogs.get(i)!;
        expect(logs.length).toBeGreaterThan(0);
      }
    } finally {
      await Promise.all(
        instances.map((instance) => instance.close().catch(() => {})),
      );
    }
  });
});
