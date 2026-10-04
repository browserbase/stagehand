import { describe, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright";
import { Stagehand, localBrowser, type ClientLLM, type ModelName } from "@browserbasehq/stagehand";
import * as replay from "../../tasks/replay.js";
import { captureObservation } from "../../tasks/record.js";
import { EvalLogger } from "../../logger.js";
import targeted from "../../tasks/bench/extract/extract_aigrant_targeted.js";
import targetedBoundary from "../../tasks/bench/extract/extract_aigrant_targeted_2.js";
import fileUpload from "../../tasks/bench/observe/observe_file_uploads.js";

const origin = "https://browserbase.github.io/stagehand-eval-sites/sites/";
const cases = [
  { task: targeted, site: "aigrant", kind: "extract" },
  { task: targetedBoundary, site: "aigrant", kind: "extract" },
  { task: fileUpload, site: "file-uploads-3", kind: "observe" },
] as const;
type EvalCase = (typeof cases)[number];
type Variant = "recorded" | "source" | "lossy";
// Stagehand.create validates the configured name against the SDK's model enum.
const realModelName = process.env.TASK_VALIDATION_MODEL as ModelName | undefined;

function deterministicModel(kind: EvalCase["kind"], prompts: string[]): ClientLLM {
  return {
    generate: async (params) => {
      if (
        params.responseFormat?.type === "json_schema" &&
        params.responseFormat.name === "Metadata"
      )
        return {
          role: "assistant",
          content: { type: "text", text: "complete" },
          outputFormat: "json_schema",
          structuredContent: { progress: "Extracted company", completed: true },
        };
      const prompt = params.messages
        .flatMap((message) =>
          (Array.isArray(message.content) ? message.content : [message.content])
            .filter((content) => content.type === "text")
            .map((content) => content.text),
        )
        .join("\n");
      prompts.push(prompt.replace(/\[\d+-\d+\]/g, "[id]"));
      let structuredContent:
        | { company_name: string }
        | {
            elements: {
              elementId: string;
              description: string;
              method: string;
              arguments: string[];
            }[];
          };
      if (kind === "extract") {
        // Read the value from real Stagehand input; the neighboring company
        // must stay outside the task's targeted XPath observation boundary.
        const company = prompt.match(/link: (Coframe)\b/);
        expect(company, "company link missing from Stagehand observation").not.toBeNull();
        expect(prompt).not.toContain("OpusClip");
        structuredContent = { company_name: company![1] };
      } else {
        const target = prompt
          .split("\n")
          .find((line) => /\[\d+-\d+\] (?:button|input)/i.test(line));
        const elementId = target?.match(/\[(\d+-\d+)\]/)?.[1];
        expect(elementId, prompt).toBeDefined();
        structuredContent = {
          elements: [
            {
              elementId: elementId!,
              description: "File upload",
              method: "click",
              arguments: [],
            },
          ],
        };
      }
      return {
        role: "assistant",
        content: { type: "text", text: "deterministic task validation" },
        outputFormat: "json_schema",
        structuredContent,
      };
    },
  };
}

async function runTask(entry: EvalCase, variant: Variant, useRealModel = false) {
  const prompts: string[] = [];
  if (useRealModel && !process.env.OPENAI_API_KEY)
    throw new Error("Real-model validation requires OPENAI_API_KEY");
  if (useRealModel && !realModelName?.startsWith("openai/"))
    throw new Error("TASK_VALIDATION_MODEL must be an openai/ model");
  const model = useRealModel
    ? { modelName: realModelName!, apiKey: process.env.OPENAI_API_KEY! }
    : deterministicModel(entry.kind, prompts);
  // Real-model runs need provider access; deterministic replay additionally
  // blocks DNS. The recorded document's CSP blocks remote page assets in both.
  const browser = await localBrowser.launch({
    headless: true,
    ...(variant !== "source" && !useRealModel
      ? { args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] }
      : {}),
  });
  let stagehand: Stagehand | undefined;
  const originalReplay = replay.gotoRecordedTask;
  try {
    stagehand = await Stagehand.create({ browser, model, logging: { level: "off" } });
    const page = await browser.context.newPage();
    // Use the actual replay path normally; substitute only the live source or
    // deliberately damaged DOM. Instructions, schemas and assertions stay intact.
    const navigation = vi
      .spyOn(replay, "gotoRecordedTask")
      .mockImplementation(async (targetPage, name) => {
        expect(name).toBe(entry.site);
        if (variant === "source") {
          await targetPage.setViewportSize(1280, 720);
          await targetPage.goto(`${origin}${name}/`);
        } else {
          await originalReplay(targetPage, name);
          if (variant === "lossy") {
            await targetPage.evaluate(() => {
              const company = document.evaluate(
                "/html/body/div/ul[5]/li[28]//a",
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null,
              ).singleNodeValue;
              if (!company) throw new Error("Missing negative-control target");
              company.textContent = "MISSING COMPANY";
            });
          }
        }
      });
    const result = await entry.task.fn({
      stagehand,
      page,
      logger: new EvalLogger(false),
      input: { name: entry.task.meta.name!, modelName: realModelName ?? "gpt-4o" },
      modelName: realModelName ?? "gpt-4o",
      debugUrl: "",
      sessionUrl: "",
    });
    expect(navigation).toHaveBeenCalledTimes(1);
    expect(result, JSON.stringify(result)).toMatchObject({ _success: true });
    if (!useRealModel) expect(prompts).toHaveLength(1);
    return prompts;
  } finally {
    vi.restoreAllMocks();
    try {
      await stagehand?.close();
    } finally {
      await browser.close();
    }
  }
}

describe("recorded existing benchmarks (offline)", () => {
  for (const entry of cases) {
    test(`${entry.task.meta.name}: passes its original assertions`, async () => {
      await runTask(entry, "recorded");
    });
  }

  test("targeted extraction validation rejects lost company text", async () => {
    await expect(runTask(cases[0], "lossy")).rejects.toThrow(
      "company link missing from Stagehand observation",
    );
  });

  test("recording bytes match the reviewed manifest hashes", async () => {
    for (const site of new Set(cases.map((entry) => entry.site))) {
      const directory = new URL(`../../assets/observation-tasks/${site}/`, import.meta.url);
      const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
      const html = gunzipSync(await readFile(new URL("index.html.gz", directory)));
      expect(createHash("sha256").update(html).digest("hex")).toBe(manifest.htmlSha256);
      expect(manifest.sourceUrl).toBe(`${origin}${site}/`);
      expect(manifest.viewport).toEqual({ width: 1280, height: 720 });
    }
  });
});

// Live source comparisons deliberately remain opt-in; offline replay above is
// part of the regular browser integration suite and uses the committed assets.
describe.skipIf(process.env.VALIDATE_EXISTING_EVAL_TASKS !== "1")("live source fidelity", () => {
  for (const entry of cases) {
    test(`${entry.task.meta.name}: source and saved observation prompts match`, async () => {
      expect(await runTask(entry, "recorded")).toEqual(await runTask(entry, "source"));
    });
  }

  test("extract_single_link stays live: its source has unsupported frames", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${origin}geniusee/`);
      expect(await page.locator("iframe, frame").count()).toBeGreaterThan(0);
      await expect(captureObservation(page)).rejects.toThrow(
        "Observation tasks do not support frames or shadow DOM",
      );
    } finally {
      await browser.close();
    }
  });
});

// An explicit model name opts into paid calls. The key is never required for
// ordinary tests. Repeat each pair to avoid treating a single lucky run as proof.
describe.skipIf(!realModelName)("real-model source and recording comparison", () => {
  for (const repeat of [1, 2, 3]) {
    for (const entry of cases) {
      test(`${entry.task.meta.name}: real-model pair ${repeat}`, async () => {
        await runTask(entry, "source", true);
        await runTask(entry, "recorded", true);
      }, 120_000);
    }
  }
});
