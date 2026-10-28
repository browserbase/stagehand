import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import { Page, type PageSetContentOptions } from "../src/index.js";

describe("Page.setContent", () => {
  it("forwards HTML and lifecycle options without changing the page identity", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const page = new Page({ send, onNotification: () => () => {} }, { pageId: "page-1" });
    const html = '<!doctype html><h1 title="雪">Hello</h1>';
    const options: PageSetContentOptions = { waitUntil: "networkidle", timeout: 0 };

    expectTypeOf<ReturnType<Page["setContent"]>>().toEqualTypeOf<Promise<void>>();
    await expect(page.setContent(html, options)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledExactlyOnceWith(StagehandMethods.pageSetContent, {
      pageId: "page-1",
      html,
      options,
    });
    expect(page.ref).toStrictEqual({ pageId: "page-1" });
  });

  it("allows empty HTML and omits unspecified options", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const page = new Page({ send, onNotification: () => () => {} }, { pageId: "page-1" });

    await page.setContent("");
    expect(send).toHaveBeenCalledExactlyOnceWith(StagehandMethods.pageSetContent, {
      pageId: "page-1",
      html: "",
    });
  });

  it("preserves extension errors", async () => {
    const failure = new Error("setContent timed out");
    const send = vi.fn().mockRejectedValue(failure);
    const page = new Page({ send, onNotification: () => () => {} }, { pageId: "page-1" });

    await expect(page.setContent("<h1>Pending</h1>")).rejects.toBe(failure);
  });
});
