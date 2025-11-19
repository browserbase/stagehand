import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3DynamicTestConfig } from "./v3.dynamic.config";
import { z } from "zod";

test.describe("V3 hard timeouts", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("observe() enforces timeoutMs", async () => {
    // Tiny timeout to force the race to hit the timeout branch
    await expect(v3.observe("find something", { timeout: 5 })).rejects.toThrow(
      /timed out/i,
    );
  });

  test("extract() enforces timeoutMs", async () => {
    const schema = z.object({ title: z.string().optional() });
    await expect(
      v3.extract("Extract title", schema, { timeout: 5 }),
    ).rejects.toThrow(/timed out/i);
  });

  test("act() enforces timeoutMs", async () => {
    await expect(v3.act("do nothing", { timeout: 5 })).rejects.toThrow(
      /timed out/i,
    );
  });
});
