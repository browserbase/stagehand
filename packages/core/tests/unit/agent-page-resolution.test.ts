import { describe, expect, it, vi } from "vitest";
import { actTool } from "../../lib/v3/agent/tools/act.js";
import { extractTool } from "../../lib/v3/agent/tools/extract.js";
import { fillFormTool } from "../../lib/v3/agent/tools/fillform.js";
import { gotoTool } from "../../lib/v3/agent/tools/goto.js";
import { screenshotTool } from "../../lib/v3/agent/tools/screenshot.js";
import type { V3 } from "../../lib/v3/v3.js";
import type { Page } from "../../lib/v3/understudy/page.js";

const toolCtx = (id: string) => ({
  toolCallId: id,
  messages: [] as never[],
  abortSignal: new AbortController().signal,
});

function createMockV3(globalPage?: Page) {
  const calls: { method: string; page: unknown }[] = [];
  const mock = {
    logger: vi.fn(),
    recordAgentReplayStep: vi.fn(),
    context: {
      awaitActivePage: vi.fn().mockResolvedValue(globalPage ?? {}),
    },
    act: vi.fn(async (_instruction: unknown, options?: { page?: unknown }) => {
      calls.push({ method: "act", page: options?.page });
      return {
        success: true,
        message: "ok",
        actionDescription: "clicked",
        actions: [],
      };
    }),
    extract: vi.fn(
      async (
        _instruction: unknown,
        _schema: unknown,
        options?: { page?: unknown },
      ) => {
        calls.push({ method: "extract", page: options?.page });
        return { extraction: "data" };
      },
    ),
    observe: vi.fn(
      async (_instruction: unknown, options?: { page?: unknown }) => {
        calls.push({ method: "observe", page: options?.page });
        return [];
      },
    ),
    calls,
  };
  return mock as unknown as V3 & {
    calls: typeof calls;
    context: { awaitActivePage: ReturnType<typeof vi.fn> };
  };
}

describe("agent tools use explicit page", () => {
  const fakePage = { id: "explicit-page" } as unknown as Page;

  it("actTool passes page to v3.act()", async () => {
    const v3 = createMockV3();
    // actTool(v3, executionModel?, variables?, toolTimeout?, page?)
    const tool = actTool(v3, undefined, undefined, undefined, fakePage);
    await tool.execute!({ action: "click the button" }, toolCtx("1"));

    expect(v3.calls[0].page).toBe(fakePage);
  });

  it("actTool passes undefined page when none provided", async () => {
    const v3 = createMockV3();
    const tool = actTool(v3);
    await tool.execute!({ action: "click the button" }, toolCtx("2"));

    expect(v3.calls[0].page).toBeUndefined();
  });

  it("extractTool passes page to v3.extract()", async () => {
    const v3 = createMockV3();
    // extractTool(v3, executionModel?, toolTimeout?, page?)
    const tool = extractTool(v3, undefined, undefined, fakePage);
    await tool.execute!(
      { instruction: "get the title", schema: undefined },
      toolCtx("3"),
    );

    expect(v3.calls[0].page).toBe(fakePage);
  });

  it("fillFormTool passes page to v3.observe()", async () => {
    const v3 = createMockV3();
    // fillFormTool(v3, executionModel?, variables?, toolTimeout?, page?)
    const tool = fillFormTool(v3, undefined, undefined, undefined, fakePage);
    await tool.execute!(
      { fields: [{ action: "type hello into name", value: "hello" }] },
      toolCtx("4"),
    );

    expect(v3.calls[0].method).toBe("observe");
    expect(v3.calls[0].page).toBe(fakePage);
  });

  it("gotoTool uses explicit page instead of awaitActivePage", async () => {
    const globalPage = { id: "global", goto: vi.fn() } as unknown as Page;
    const explicitPage = { id: "explicit", goto: vi.fn() } as unknown as Page;
    const v3 = createMockV3(globalPage);

    // gotoTool(v3, page?)
    const tool = gotoTool(v3, explicitPage);
    await tool.execute!({ url: "https://example.com" }, toolCtx("5"));

    expect((explicitPage as any).goto).toHaveBeenCalledWith(
      "https://example.com",
      { waitUntil: "load" },
    );
    expect((globalPage as any).goto).not.toHaveBeenCalled();
    expect(v3.context.awaitActivePage).not.toHaveBeenCalled();
  });

  it("gotoTool falls back to awaitActivePage when no page", async () => {
    const globalPage = { id: "global", goto: vi.fn() } as unknown as Page;
    const v3 = createMockV3(globalPage);

    const tool = gotoTool(v3);
    await tool.execute!({ url: "https://example.com" }, toolCtx("6"));

    expect((globalPage as any).goto).toHaveBeenCalled();
    expect(v3.context.awaitActivePage).toHaveBeenCalledOnce();
  });

  it("screenshotTool uses explicit page instead of awaitActivePage", async () => {
    const globalPage = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from("g")),
      url: vi.fn().mockReturnValue("https://global.com"),
    } as unknown as Page;
    const explicitPage = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from("e")),
      url: vi.fn().mockReturnValue("https://explicit.com"),
    } as unknown as Page;
    const v3 = createMockV3(globalPage);

    // screenshotTool(v3, page?)
    const tool = screenshotTool(v3, explicitPage);
    const result = await tool.execute!({}, toolCtx("7"));

    expect((explicitPage as any).screenshot).toHaveBeenCalled();
    expect((globalPage as any).screenshot).not.toHaveBeenCalled();
    expect(v3.context.awaitActivePage).not.toHaveBeenCalled();
    expect((result as { pageUrl: string }).pageUrl).toBe(
      "https://explicit.com",
    );
  });
});
