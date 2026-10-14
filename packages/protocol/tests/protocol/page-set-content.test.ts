import { describe, expect, it } from "vitest";
import { wireSchema } from "../../json-rpc/wire-casing.js";
import { StagehandMethods } from "../../schema-registry.js";
import { PageSetContentParamsSchema } from "../../schemas.js";

describe("page.set_content protocol", () => {
  it("accepts empty HTML and optional lifecycle controls", () => {
    expect(PageSetContentParamsSchema.parse({ pageId: "page-1", html: "" })).toStrictEqual({
      pageId: "page-1",
      html: "",
    });
    for (const waitUntil of ["load", "domcontentloaded", "networkidle"]) {
      const params = { pageId: "page-1", html: "<h1>Hello</h1>", options: { waitUntil } };
      expect(PageSetContentParamsSchema.parse(params)).toStrictEqual(params);
    }
  });

  it("decodes snake-case options without interpreting HTML", () => {
    const html = '<p data-snake_case="camelCase">雪</p>';
    expect(
      wireSchema(StagehandMethods.pageSetContent.params).parse({
        page_id: "page-1",
        html,
        options: { wait_until: "load", timeout: 0 },
      }),
    ).toStrictEqual({ pageId: "page-1", html, options: { waitUntil: "load", timeout: 0 } });
  });

  it.each([0, 0.5, 30_000, 2_147_473_647])("accepts timeout %s", (timeout) => {
    expect(
      PageSetContentParamsSchema.parse({ pageId: "page-1", html: "", options: { timeout } }),
    ).toStrictEqual({ pageId: "page-1", html: "", options: { timeout } });
  });

  it.each([
    { timeout: -1 },
    { timeout: Number.NaN },
    { timeout: Number.POSITIVE_INFINITY },
    { timeout: 2_147_473_648 },
    { waitUntil: "commit" },
    { unrelated: true },
  ])("rejects invalid options %j", (options) => {
    expect(() =>
      PageSetContentParamsSchema.parse({ pageId: "page-1", html: "", options }),
    ).toThrow();
  });

  it("requires string HTML and page identity", () => {
    for (const params of [{ pageId: "page-1" }, { html: "" }, { pageId: "page-1", html: null }]) {
      expect(() => PageSetContentParamsSchema.parse(params)).toThrow();
    }
    expect(StagehandMethods.pageSetContent.result.parse({ ok: true })).toStrictEqual({ ok: true });
  });
});
