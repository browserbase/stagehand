import { describe, expect, it } from "vitest";
import { StagehandMethods } from "../../schema-registry.js";
import { AcknowledgementResultSchema } from "../../schemas.js";

describe("AcknowledgementResultSchema", () => {
  it("accepts only the successful acknowledgement literal", () => {
    expect(AcknowledgementResultSchema.parse(true)).toBe(true);
    expect(() => AcknowledgementResultSchema.parse(false)).toThrow();
    expect(() => AcknowledgementResultSchema.parse(null)).toThrow();
    expect(() => AcknowledgementResultSchema.parse({ ok: true })).toThrow();
  });

  it("is shared directly by every side-effect-only method", () => {
    const methodNames = Object.values(StagehandMethods)
      .filter((method) => method.result === AcknowledgementResultSchema)
      .map((method) => method.name)
      .sort();

    expect(methodNames).toStrictEqual(
      [
        "context.add_cookies",
        "context.add_init_script",
        "context.clear_cookies",
        "context.clipboard_clear",
        "context.clipboard_copy",
        "context.clipboard_cut",
        "context.clipboard_paste",
        "context.clipboard_write_text",
        "context.close",
        "context.set_active_page",
        "context.set_domain_policy",
        "context.set_extra_http_headers",
        "locator.click",
        "locator.fill",
        "locator.highlight",
        "locator.hover",
        "locator.scroll_to",
        "locator.send_click_event",
        "locator.type",
        "page.add_init_script",
        "page.close",
        "page.key_press",
        "page.set_extra_http_headers",
        "page.set_viewport_size",
        "page.type",
        "page.wait_for_load_state",
        "page.wait_for_timeout",
        "stagehand.close",
      ].sort(),
    );
  });
});
