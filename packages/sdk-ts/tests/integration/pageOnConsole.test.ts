/* oxlint-disable no-console -- Browser-side console calls are the behavior under test. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ConsoleListener, type Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

type ConsoleEvent = Parameters<ConsoleListener>[0];

describe("dedicated console callbacks", () => {
  let stagehand: Stagehand;
  let fixture: FixtureServer;

  beforeAll(async () => {
    fixture = await startFixtureServer("<!doctype html><title>Console fixture</title>");
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await fixture?.close();
  });

  it("matches the legacy payload across navigation and independently unsubscribes", async () => {
    const page = await firstPage(stagehand);
    const modern: ConsoleEvent[] = [];
    const legacy: ConsoleEvent[] = [];
    const alias = await page.onConsole((event) => modern.push(event));
    const original = await page.on("console", (event) => legacy.push(event));
    try {
      for (const path of ["?first", "?second"]) {
        await page.goto(`${fixture.url}${path}`);
        await page.evaluate((label) => {
          console.log(label, 42, { hello: "world" });
          console.warn(label);
          console.error(label);
        }, path);
      }
      await expect.poll(() => modern.length).toBe(6);
      await expect.poll(() => legacy.length).toBe(6);
      expect(modern).toEqual(legacy);
      expect(modern.map((event) => event.params.type)).toEqual([
        "log",
        "warning",
        "error",
        "log",
        "warning",
        "error",
      ]);
      expect(modern[0]).toMatchObject({
        method: "Runtime.consoleAPICalled",
        pageId: page.pageId,
        sessionId: expect.any(String),
        targetId: expect.any(String),
        params: {
          args: [
            { type: "string", value: "?first" },
            { type: "number", value: 42 },
            expect.objectContaining({ type: "object" }),
          ],
        },
      });

      await alias.unsubscribe();
      await alias.unsubscribe();
      await page.evaluate(() => console.log("legacy still active"));
      await expect.poll(() => legacy.length).toBe(7);
      expect(modern).toHaveLength(6);

      const witness: ConsoleEvent[] = [];
      const observer = await page.onConsole((event) => witness.push(event));
      try {
        await original.unsubscribe();
        await page.evaluate(() => console.log("observer only"));
        await expect.poll(() => witness.length).toBe(1);
        expect(modern).toHaveLength(6);
        expect(legacy).toHaveLength(7);
      } finally {
        await observer.unsubscribe();
      }
    } finally {
      await alias.unsubscribe();
      await original.unsubscribe();
    }
  });
});
