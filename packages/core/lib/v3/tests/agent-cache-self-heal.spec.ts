import { test, expect } from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import type {
  AgentReplayActStep,
  AgentReplayFillFormStep,
  CachedAgentEntry,
} from "../types/private/cache";

test.describe("Agent cache self-heal (e2e)", () => {
  let v3: V3;
  let cacheDir: string;

  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(async ({}, testInfo) => {
    await fs.mkdir(testInfo.outputDir, { recursive: true });
    cacheDir = await fs.mkdtemp(path.join(testInfo.outputDir, "agent-cache-"));
    v3 = new V3({
      ...v3TestConfig,
      cacheDir,
      selfHeal: true,
    });
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("replays heal corrupted selectors", async () => {
    test.setTimeout(120_000);

    const agent = v3.agent({
      model: "anthropic/claude-haiku-4-5-20251001",
    });
    const page = v3.context.pages()[0];
    const url =
      "https://browserbase.github.io/stagehand-eval-sites/sites/shadow-dom/";
    const instruction = "click the button";

    await page.goto(url, { waitUntil: "networkidle" });
    const firstResult = await agent.execute({ instruction, maxSteps: 20 });
    expect(firstResult.success).toBe(true);

    const cachePath = await locateAgentCacheFile(cacheDir);
    const originalEntry = await readCacheEntry(cachePath);
    const originalActionStep = findFirstActionStep(originalEntry);
    expect(originalActionStep).toBeDefined();
    const originalSelector = originalActionStep?.actions?.[0]?.selector;
    expect(typeof originalSelector).toBe("string");

    // Corrupt the cached selector so the replay needs to self-heal.
    if (originalActionStep?.actions?.[0]) {
      originalActionStep.actions[0].selector = "xpath=/yeee";
    }
    await fs.writeFile(
      cachePath,
      JSON.stringify(originalEntry, null, 2),
      "utf8",
    );

    // Second run should replay from cache, self-heal, and update the file.
    await page.goto(url, { waitUntil: "networkidle" });
    const replayResult = await agent.execute({ instruction, maxSteps: 20 });
    expect(replayResult.success).toBe(true);

    const healedEntry = await readCacheEntry(cachePath);
    const healedActionStep = findFirstActionStep(healedEntry);
    expect(healedActionStep?.actions?.[0]?.selector).toBe(originalSelector);
    expect(healedActionStep?.actions?.[0]?.selector).not.toBe("xpath=/yeee");
    expect(healedEntry.timestamp).not.toBe(originalEntry.timestamp);
  });
});

async function locateAgentCacheFile(cacheDir: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const entries = await fs.readdir(cacheDir);
    const agentFiles = entries.filter((file) => file.startsWith("agent-"));
    if (agentFiles.length > 0) {
      return path.join(cacheDir, agentFiles[0]!);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for agent cache entry to be written");
}

async function readCacheEntry(cachePath: string): Promise<CachedAgentEntry> {
  const raw = await fs.readFile(cachePath, "utf8");
  return JSON.parse(raw) as CachedAgentEntry;
}

type StepWithActions = AgentReplayActStep | AgentReplayFillFormStep;

function findFirstActionStep(
  entry: CachedAgentEntry,
): StepWithActions | undefined {
  return entry.steps.find((step) => {
    const actions = (step as StepWithActions).actions;
    return Array.isArray(actions) && actions.length > 0;
  }) as StepWithActions | undefined;
}
