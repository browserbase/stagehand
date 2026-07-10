import { describe, expect, it } from "vite-plus/test";
import {
  createStagehandProtocolRequest,
  parseStagehandProtocolParams,
  parseStagehandProtocolResult,
  StagehandProtocolRequestSchema,
  StagehandProtocolSchema,
  STAGEHAND_PROTOCOL_VERSION,
} from "../../events.js";

describe("Stagehand object-model protocol", () => {
  it("creates stagehand init requests", () => {
    expect(
      createStagehandProtocolRequest("1", "stagehand.init", {
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
        model: { provider: "openai", name: "gpt-5-mini" },
      }),
    ).toStrictEqual({
      id: "1",
      command: "stagehand.init",
      params: {
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
        model: { provider: "openai", name: "gpt-5-mini" },
      },
    });
  });

  it("requires page ids for page commands", () => {
    expect(() =>
      parseStagehandProtocolParams("page.goto", {
        url: "https://example.com",
        wait_until: "load",
      }),
    ).toThrow();

    expect(
      parseStagehandProtocolParams("page.goto", {
        pageId: "target-1",
        url: "https://example.com",
        options: { waitUntil: "load", timeoutMs: 10_000 },
      }),
    ).toStrictEqual({
      pageId: "target-1",
      url: "https://example.com",
      options: { waitUntil: "load", timeoutMs: 10_000 },
    });
  });

  it("keeps locators as page-scoped descriptors", () => {
    expect(
      parseStagehandProtocolParams("locator.textContent", {
        pageId: "target-1",
        selector: "h1",
      }),
    ).toStrictEqual({
      pageId: "target-1",
      selector: "h1",
    });
  });

  it("validates page and locator results", () => {
    expect(
      parseStagehandProtocolResult("context.pages", [
        {
          objectId: "target-1",
          type: "page",
          targetId: "target-1",
          mainFrameId: "frame-1",
          url: "https://example.com",
        },
      ]),
    ).toStrictEqual([
      {
        objectId: "target-1",
        type: "page",
        targetId: "target-1",
        mainFrameId: "frame-1",
        url: "https://example.com",
      },
    ]);

    expect(
      parseStagehandProtocolResult("locator.textContent", {
        textContent: "Example Domain",
      }),
    ).toStrictEqual({ textContent: "Example Domain" });
  });

  it("exports a single schema for generated clients", () => {
    const request = StagehandProtocolRequestSchema.parse({
      id: "2",
      command: "context.pages",
      params: {},
    });

    expect(
      StagehandProtocolSchema.parse({
        version: STAGEHAND_PROTOCOL_VERSION,
        request,
        response: {
          ok: true,
          id: "2",
          command: "context.pages",
          result: [],
        },
      }),
    ).toStrictEqual({
      version: STAGEHAND_PROTOCOL_VERSION,
      request,
      response: {
        ok: true,
        id: "2",
        command: "context.pages",
        result: [],
      },
    });
  });
});
