import { afterEach, describe, expect, it } from "vitest";
import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";

import { createFacadeMCPClient } from "../src/client.js";

type FacadeClient = Awaited<ReturnType<typeof createFacadeMCPClient>>;

describe("Stagehand facade MCP client", () => {
  let client: FacadeClient | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
    delete process.env.STAGEHAND_BROWSER;
    delete process.env.NOT_ALLOWLISTED_SECRET;
  });

  // The contract itself (tool names, descriptions, schemas) is pinned by
  // core's facade tests; this test covers only what is unique to this
  // example — the host-env allowlist actually reaching the spawned server.
  it("forwards allowlisted host env vars and nothing else", async () => {
    process.env.STAGEHAND_BROWSER = "invalid";
    process.env.NOT_ALLOWLISTED_SECRET = "must-not-cross";
    client = await createFacadeMCPClient();

    const tools = await client.tools();
    expect(Object.keys(tools).length).toBeGreaterThan(0);
    const execute = tools.snapshot?.execute;
    expect(execute).toBeDefined();
    if (!execute) throw new Error("snapshot tool is missing an execute function");

    const result = (await execute(
      {},
      { toolCallId: "test-call", messages: [], context: undefined },
    )) as {
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

    // The server saw STAGEHAND_BROWSER=invalid from the host environment via
    // the allowlist filter — proving the filter path runs (an options.env
    // injection would bypass it).
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("STAGEHAND_BROWSER must be either"),
        }),
      ]),
    );
  });

  it("allowlist excludes non-STAGEHAND/BROWSERBASE host vars", async () => {
    process.env.STAGEHAND_BROWSER = "local";
    process.env.NOT_ALLOWLISTED_SECRET = "must-not-cross";
    const env = buildAllowlistedEnv();
    expect(env.STAGEHAND_BROWSER).toBe("local");
    expect(env).not.toHaveProperty("NOT_ALLOWLISTED_SECRET");
  });
});
