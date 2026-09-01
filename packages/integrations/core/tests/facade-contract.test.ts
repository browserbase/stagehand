import { describe, expect, it } from "vitest";
import {
  CodeModeRunInputSchema,
  FACADE_AGENT_INSTRUCTIONS,
  FACADE_LEGACY_TOOLS,
  FACADE_TOOLS,
  facadeSurfaceFromArgs,
  facadeToolsForSurface,
  LEGACY_FACADE_AGENT_INSTRUCTIONS,
  NAVIGATED_SNAPSHOT_ERROR,
  NO_HYDRATED_SNAPSHOT_ERROR,
  STALE_SNAPSHOT_ID_ERROR,
} from "../src/facade/contract.js";
import { StagehandFacadeConfigError, stagehandFacadeConfigFromEnv } from "../src/facade/config.js";

describe("Stagehand facade contract", () => {
  it("defaults local browser launches to headed mode", () => {
    expect(stagehandFacadeConfigFromEnv({}).browser).toStrictEqual({
      type: "local",
      launchOptions: { headless: false },
    });
  });

  it("creates Browserbase sessions with an explicit timeout and no keep-alive", () => {
    const env = { BROWSERBASE_API_KEY: "bb-key", BROWSERBASE_PROJECT_ID: "proj" };
    expect(stagehandFacadeConfigFromEnv(env).browser).toStrictEqual({
      type: "browserbase",
      launchOptions: { apiKey: "bb-key", projectId: "proj", timeout: 3600, keepAlive: false },
    });
    expect(
      stagehandFacadeConfigFromEnv({
        ...env,
        STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS: "21600",
      }).browser.launchOptions,
    ).toMatchObject({ timeout: 21_600 });
    for (const invalid of ["0", "-1", "90.5", "soon", "21601"]) {
      expect(() =>
        stagehandFacadeConfigFromEnv({
          ...env,
          STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS: invalid,
        }),
      ).toThrow(StagehandFacadeConfigError);
    }
  });

  it("passes proxies/verified through to the Browserbase session when configured", () => {
    const env = { BROWSERBASE_API_KEY: "bb-key" };
    expect(stagehandFacadeConfigFromEnv(env).browser.launchOptions).not.toHaveProperty("proxies");
    expect(
      stagehandFacadeConfigFromEnv({
        ...env,
        STAGEHAND_BROWSERBASE_PROXIES: "1",
        STAGEHAND_BROWSERBASE_VERIFIED: "true",
      }).browser.launchOptions,
    ).toMatchObject({ proxies: true, browserSettings: { verified: true } });
    expect(
      stagehandFacadeConfigFromEnv({ ...env, STAGEHAND_BROWSERBASE_PROXIES: "off" }).browser
        .launchOptions,
    ).toMatchObject({ proxies: false });
    expect(() =>
      stagehandFacadeConfigFromEnv({ ...env, STAGEHAND_BROWSERBASE_VERIFIED: "maybe" }),
    ).toThrow(/STAGEHAND_BROWSERBASE_VERIFIED must be a boolean/);
  });

  it("pins the three tool names and descriptions", () => {
    expect(FACADE_TOOLS.map((tool) => tool.name)).toStrictEqual(["run", "snapshot", "screenshot"]);
    expect(FACADE_TOOLS[0].description).toContain("Browse and automate websites");
    expect(FACADE_TOOLS[0].description).toContain('await page.goto("https://example.com")');
    expect(FACADE_TOOLS[0].description).toContain("no separate navigate or start tool");
    expect(FACADE_TOOLS[0].description).toContain('"op" (never "kind")');
    expect(FACADE_TOOLS[0].description).toContain('"id" (never "ref")');
    expect(FACADE_TOOLS[0].description).toContain('{"actions":[{"op":"click","id":"1-42"}]}');
    expect(FACADE_TOOLS[0].description).toContain(
      '{"actions":[{"op":"fill","id":"2-14","value":"Miami"}]}',
    );
    expect(FACADE_TOOLS[0].description).toContain(
      '{"actions":[{"op":"select","id":"3-9","values":"Lowest price"}]}',
    );
    expect(FACADE_TOOLS[2].description).toContain('{"type":"jpeg","quality":40,"fullPage":false}');
  });

  it("advertises the Playwright idiom and no Stagehand AI methods", () => {
    expect(FACADE_TOOLS[0].description).toContain("page, context, and browser in scope");
    expect(FACADE_TOOLS[0].description).toContain("Playwright-shaped API");
    expect(FACADE_AGENT_INSTRUCTIONS).toContain("Playwright page, context, and browser");
    expect(FACADE_AGENT_INSTRUCTIONS).toContain("page.getByRole(");
    for (const text of [FACADE_TOOLS[0].description, FACADE_AGENT_INSTRUCTIONS]) {
      expect(text).not.toMatch(/\b(act|extract|observe)\(/u);
      expect(text).not.toContain("stagehand.");
    }
  });

  it("keeps the legacy surface byte-identical except for the run description", () => {
    expect(FACADE_LEGACY_TOOLS.map((tool) => tool.name)).toStrictEqual([
      "run",
      "snapshot",
      "screenshot",
    ]);
    expect(FACADE_LEGACY_TOOLS[0].description).toBe(
      'Browse and automate websites in the persistent Stagehand browser. Navigate with JavaScript such as await page.goto("https://example.com"); there is no separate navigate or start tool. Execute either a JavaScript workflow against the Stagehand Playwright facade or a batch of actions using IDs from the latest snapshot. Provide exactly one of code or actions. Each action must use "op" (never "kind") and "id" (never "ref"). Copy the bracketed snapshot ID as a string. Examples: {"actions":[{"op":"click","id":"1-42"}]}, {"actions":[{"op":"fill","id":"2-14","value":"Miami"}]}, {"actions":[{"op":"select","id":"3-9","values":"Lowest price"}]}.',
    );
    expect(FACADE_LEGACY_TOOLS[0].inputSchema).toBe(FACADE_TOOLS[0].inputSchema);
    expect(FACADE_LEGACY_TOOLS[1]).toBe(FACADE_TOOLS[1]);
    expect(FACADE_LEGACY_TOOLS[2]).toBe(FACADE_TOOLS[2]);
    expect(LEGACY_FACADE_AGENT_INSTRUCTIONS).toContain(
      "Use snapshot actions for simple interactions",
    );
    expect(LEGACY_FACADE_AGENT_INSTRUCTIONS).not.toBe(FACADE_AGENT_INSTRUCTIONS);
  });

  it("selects the surface from --surface", () => {
    expect(facadeSurfaceFromArgs([])).toBe("playwright");
    expect(facadeSurfaceFromArgs(["--max-screenshot-base64-bytes=4096"])).toBe("playwright");
    expect(facadeSurfaceFromArgs(["--surface=legacy"])).toBe("legacy");
    expect(facadeSurfaceFromArgs(["--surface=playwright"])).toBe("playwright");
    expect(() => facadeSurfaceFromArgs(["--surface=codemode"])).toThrow("--surface=");
    expect(facadeToolsForSurface("legacy")).toBe(FACADE_LEGACY_TOOLS);
    expect(facadeToolsForSurface("playwright")).toBe(FACADE_TOOLS);
  });

  it("pins snapshot error punctuation", () => {
    expect(NO_HYDRATED_SNAPSHOT_ERROR).toBe(
      "No hydrated snapshot exists for the active page; call snapshot first.",
    );
    expect(NAVIGATED_SNAPSHOT_ERROR).toBe(
      "The active page navigated after its snapshot; call snapshot again.",
    );
    expect(STALE_SNAPSHOT_ID_ERROR).toBe(
      'Snapshot ID "${id}" is stale or not actionable; call snapshot again.',
    );
  });

  it("pins the run JSON schema", () => {
    const runSchema = FACADE_TOOLS[0].inputSchema;
    expect(Object.keys(runSchema.properties)).toStrictEqual(["code", "actions"]);
    // Deliberate deviation from the reference: no top-level oneOf — AI-SDK
    // based MCP clients reject it. Exclusivity is enforced at runtime by
    // CodeModeRunInputSchema instead (asserted below).
    expect("oneOf" in runSchema).toBe(false);
    expect(runSchema.additionalProperties).toBe(false);
    expect(CodeModeRunInputSchema.safeParse({ code: "return 1;" }).success).toBe(true);
    expect(CodeModeRunInputSchema.safeParse({}).success).toBe(false);
    expect(
      CodeModeRunInputSchema.safeParse({
        code: "return 1;",
        actions: [{ op: "click", id: "1-1" }],
      }).success,
    ).toBe(false);

    const actions = runSchema.properties.actions.items.oneOf;
    expect(actions.map((action) => Object.keys(action.properties))).toStrictEqual([
      ["op", "id"],
      ["op", "id"],
      ["op", "id", "value"],
      ["op", "id", "text", "delay"],
      ["op", "id", "key"],
      ["op", "id", "values"],
    ]);
    expect(actions.map((action) => action.required)).toStrictEqual([
      ["op", "id"],
      ["op", "id"],
      ["op", "id", "value"],
      ["op", "id", "text"],
      ["op", "id", "key"],
      ["op", "id", "values"],
    ]);
    expect(actions.every((action) => action.additionalProperties === false)).toBe(true);
    expect(actions[0].properties.op.description).toContain('never use a "kind" field');
    expect(actions[0].properties.id.description).toContain('never use "ref"');
  });

  it("pins snapshot and screenshot JSON schema properties", () => {
    expect(Object.keys(FACADE_TOOLS[1].inputSchema.properties)).toStrictEqual(["includeIframes"]);
    expect(Object.keys(FACADE_TOOLS[2].inputSchema.properties)).toStrictEqual([
      "fullPage",
      "type",
      "quality",
    ]);
    expect(FACADE_TOOLS[1].inputSchema.additionalProperties).toBe(false);
    expect(FACADE_TOOLS[2].inputSchema.additionalProperties).toBe(false);
  });

  it("requires exactly one of code or actions", () => {
    expect(CodeModeRunInputSchema.safeParse({ code: "return 1" }).success).toBe(true);
    expect(
      CodeModeRunInputSchema.safeParse({ actions: [{ op: "click", id: "1-42" }] }).success,
    ).toBe(true);
    expect(CodeModeRunInputSchema.safeParse({}).success).toBe(false);
    expect(
      CodeModeRunInputSchema.safeParse({
        code: "return 1",
        actions: [{ op: "click", id: "1-42" }],
      }).success,
    ).toBe(false);
  });
});
