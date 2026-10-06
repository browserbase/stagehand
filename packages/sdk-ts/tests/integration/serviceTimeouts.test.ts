import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { LLMGenerateParams, LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

function gate() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

function modelResult(params: LLMGenerateParams): LLMGenerateResult {
  const text = params.messages
    .flatMap(({ content }) => (Array.isArray(content) ? content : [content]))
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
  const target = text
    .split("\n")
    .find((line) => line.includes("Submit outside scope") && /\[\d+-\d+\]/.test(line));
  const elementId = target?.match(/\[(\d+-\d+)\]/)?.[1];
  const name = params.responseFormat?.type === "json_schema" && params.responseFormat.name;
  if (name !== "Metadata") expect(elementId).toMatch(/^\d+-\d+$/);
  const action = {
    elementId: elementId!,
    description: "Submit outside scope",
    method: "click",
    arguments: [],
  };
  return {
    role: "assistant",
    content: { type: "text", text: "fixture response" },
    outputFormat: "json_schema",
    structuredContent:
      name === "Act"
        ? { action, twoStep: false }
        : name === "Observation"
          ? { elements: [action] }
          : name === "Extraction"
            ? { label: "Submit outside scope" }
            : { completed: true, progress: "Read label" },
  };
}

describe("service timeout budgets", () => {
  let stagehand: Stagehand | undefined;
  let server: FixtureServer | undefined;
  const gates: ReturnType<typeof gate>[] = [];
  const hold = () => {
    const next = gate();
    gates.push(next);
    return next;
  };

  afterEach(async () => {
    gates.splice(0).forEach(({ release }) => release());
    await closeStagehand(stagehand);
    await server?.close();
  });

  async function fixture() {
    const child = hold();
    const childRequested = hold();
    server = await startFixtureServer({
      "/": '<button id="submit" onclick="document.body.dataset.clicked=\'yes\'">Submit outside scope</button><iframe src="/child"></iframe>',
      "/child": async () => {
        childRequested.release();
        await child.ready;
        return '<button id="target" onclick="parent.document.body.dataset.clicked=\'yes\'">Child button</button>';
      },
    });
    const generate = vi.fn(async (params: LLMGenerateParams) => modelResult(params));
    stagehand = await createStagehand({ model: { generate } });
    const page = await firstPage(stagehand);
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await childRequested.ready;
    const run = (method: "act" | "observe" | "extract", timeout: number) => {
      const options = { page, timeout, locator: page.locator("iframe >> #target") };
      if (method === "act") return stagehand!.act("Click Submit outside scope", options);
      if (method === "observe") return stagehand!.observe("Find Submit outside scope", options);
      return stagehand!.extract("Read the button label", z.object({ label: z.string() }), options);
    };
    return { page, generate, child, run };
  }

  it.each(["act", "observe", "extract"] as const)(
    "%s stops before inference when scoped snapshot readiness exhausts its budget",
    async (method) => {
      const { page, generate, child, run } = await fixture();
      await expect(run(method, method === "act" ? 1_000 : 200)).rejects.toMatchObject({
        name: "TimeoutError",
        message: expect.stringContaining(`${method}()`),
      });
      child.release();
      await expect.poll(() => page.locator("iframe >> #target").count({ timeout: 5_000 })).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(generate).not.toHaveBeenCalled();
      expect(await page.evaluate(() => document.body.dataset.clicked === "yes")).toBe(false);
    },
  );

  it.each(["act", "observe", "extract"] as const)(
    "%s can fall back to the full page but cannot continue after its model deadline",
    async (method) => {
      const { page, generate, run } = await fixture();
      const response = hold();
      generate.mockImplementation(async (params) => {
        const result = modelResult(params); // The out-of-scope button proves full-page fallback.
        await response.ready;
        return result;
      });
      await expect(run(method, 4_000)).rejects.toMatchObject({
        name: "TimeoutError",
        message: expect.stringContaining(`${method}()`),
      });
      expect(generate).toHaveBeenCalledTimes(1);
      response.release();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(generate).toHaveBeenCalledTimes(1); // No follow-up extraction request.
      expect(await page.evaluate(() => document.body.dataset.clicked === "yes")).toBe(false);
    },
  );

  it("can act on the full-page fallback while time remains", async () => {
    const { page, generate, run } = await fixture();
    const result = await run("act", 5_000);
    expect(result.data).toMatchObject({ success: true });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await page.evaluate(() => document.body.dataset.clicked)).toBe("yes");
  });

  it("does not click after a deterministic act times out waiting for its iframe", async () => {
    const { page, child, generate } = await fixture();
    await expect(
      stagehand!.act(
        {
          selector: "iframe >> #target",
          method: "click",
          arguments: [],
          description: "Child button",
        },
        { page, timeout: 250 },
      ),
    ).rejects.toMatchObject({
      name: "TimeoutError",
      message: expect.stringContaining("act()"),
    });
    child.release();
    await expect.poll(() => page.locator("iframe >> #target").count({ timeout: 5_000 })).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(await page.evaluate(() => document.body.dataset.clicked === "yes")).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    await stagehand!.act(
      {
        selector: "iframe >> #target",
        method: "click",
        arguments: [],
        description: "Child button",
      },
      { page, timeout: 5_000 },
    );
    expect(await page.evaluate(() => document.body.dataset.clicked)).toBe("yes");
  });
});
