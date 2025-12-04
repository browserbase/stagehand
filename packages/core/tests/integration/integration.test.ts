import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as Stagehand from "../../dist/index.js";
import { z } from "zod";
import {
  createStagehandHarness,
  getMissingClientEnvVars,
  resolveTestTarget,
} from "./support/stagehandClient";

const testSite =
  process.env.STAGEHAND_EVAL_URL ??
  "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/";
const agentModel =
  process.env.STAGEHAND_AGENT_MODEL ?? "openai/gpt-4o-mini";
const TEST_TIMEOUT = 180_000;

describe.sequential("Stagehand thin-client integration", () => {
  const testTarget = resolveTestTarget();
  const isRemoteTarget = testTarget === "remote";

  let stagehand: Stagehand.Stagehand;
  let activePage: Stagehand.Page;

  beforeAll(
    async () => {
      const missing = getMissingClientEnvVars(testTarget);
      if (missing.length > 0) {
        throw new Error(
          `Missing required env vars for Stagehand integration tests: ${missing.join(
            ", ",
          )}`,
        );
      }

      const harness = createStagehandHarness(testTarget);
      stagehand = harness.stagehand;

      await stagehand.init();
      activePage =
        stagehand.context.pages()[0] ?? (await stagehand.context.newPage());
    },
    TEST_TIMEOUT,
  );

  afterAll(async () => {
    if (stagehand) {
      await stagehand.close().catch(() => {});
    }
  });

  beforeEach(async () => {
    const defaultPage = stagehand.context.pages()[0];
    if (defaultPage) {
      activePage = defaultPage;
      return;
    }
    activePage = await stagehand.context.newPage();
  });

  describe("start", () => {
    it(
      "creates Browserbase sessions through the thin client",
      { timeout: TEST_TIMEOUT },
      async () => {
        expect(stagehand.browserbaseSessionID).toBeTruthy();
        if (isRemoteTarget) {
          expect(stagehand.browserbaseSessionURL).toMatch(
            /^https:\/\/www\.browserbase\.com\/sessions\//,
          );
        } else {
          expect(stagehand.browserbaseSessionURL).toBeUndefined();
        }
        expect(stagehand.context.pages().length).toBeGreaterThan(0);
      },
    );
  });

  describe("navigate", () => {
    it(
      "navigates remote pages via /navigate",
      { timeout: TEST_TIMEOUT },
      async () => {
        const response = await activePage.goto(testSite, {
          waitUntil: "domcontentloaded",
        });
        expect(response?.ok()).toBe(true);
        expect(activePage.url()).toContain("iframe-hn");
      },
    );
  });

  describe("extract", () => {
    it(
      "extracts structured data through /extract",
      { timeout: TEST_TIMEOUT, retry: 1 },
      async () => {
        await activePage.goto(testSite, { waitUntil: "domcontentloaded" });
        const summarySchema = z.object({
          topStory: z.string(),
        });

        const extraction = await stagehand.extract(
          "Return only the first visible story headline text.",
          summarySchema,
        );

        expect(extraction.topStory.length).toBeGreaterThan(5);
      },
    );
  });

  describe("observe", () => {
    it(
      "observes actionable elements and replays them via /observe and /act",
      { timeout: TEST_TIMEOUT, retry: 1 },
      async () => {
        await activePage.goto(testSite, { waitUntil: "domcontentloaded" });
        const [action] = await stagehand.observe(
          "Provide a single action that clicks the navigation link labeled 'new'.",
        );

        expect(action).toBeDefined();
        expect(action.selector.length).toBeGreaterThan(0);

        const actResult = await stagehand.act(action);
        expect(actResult.success).toBe(true);
        expect(actResult.actions.length).toBeGreaterThan(0);
      },
    );
  });

  describe("act", () => {
    // Tests for act endpoint would go here
  });

  describe("agentExecute", () => {
    it(
      "executes hosted agents through /agentExecute",
      { timeout: 240_000, retry: 1 },
      async () => {
        await activePage.goto(testSite, { waitUntil: "domcontentloaded" });
        const agent = stagehand.agent({
          model: agentModel,
          cua: false,
          systemPrompt:
            "Keep answers short. Stop once you confirm a headline is visible.",
        });

        const result = await agent.execute({
          instruction:
            "Read the current page's title and acknowledge one top story before stopping.",
          maxSteps: 4,
        });

        expect(result.success).toBe(true);
        expect(result.actions.length).toBeGreaterThan(0);
      },
    );
  });

  describe("replay", () => {
    it(
      "exposes replay metrics via /replay",
      { timeout: TEST_TIMEOUT },
      async () => {
        const metrics = await stagehand.metrics;
        expect(metrics.totalPromptTokens).toBeGreaterThan(0);
        expect(metrics.totalInferenceTimeMs).toBeGreaterThan(0);
      },
    );
  });

  describe("end", () => {
    it(
    "terminates Browserbase sessions through /end",
    { timeout: TEST_TIMEOUT },
    async () => {
      const { stagehand: ephemeral } = createStagehandHarness(testTarget);
      await ephemeral.init();
      expect(ephemeral.browserbaseSessionID).toBeTruthy();
      await ephemeral.close();
      expect(ephemeral.browserbaseSessionID).toBeUndefined();
      },
    );
  });
});
