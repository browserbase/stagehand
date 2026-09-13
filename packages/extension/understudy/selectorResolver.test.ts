import { describe, expect, it, vi } from "vitest";
import type { Frame } from "./frame.js";
import { FrameSelectorResolver } from "./selectorResolver.js";

describe("FrameSelectorResolver XPath failures", () => {
  it("propagates a sanitized unsupported-predicate error", async () => {
    const send = vi.fn().mockResolvedValue({
      exceptionDetails: {
        text: "Uncaught",
        exception: {
          description: "Error: Unsupported XPath predicate in composed-tree traversal: last()",
        },
      },
      result: {},
    });
    const frame = {
      frameId: "frame-1",
      session: { send },
    } as unknown as Frame;
    const resolver = new FrameSelectorResolver(frame);

    await expect(
      resolver.evaluateXPathElement("countXPathMatchesMainWorld()", 1),
    ).rejects.toThrow("Unsupported XPath predicate in composed-tree traversal");
  });

  it("returns null for transient main-world XPath evaluation errors", async () => {
    const send = vi.fn().mockResolvedValue({
      exceptionDetails: { text: "Execution context was destroyed" },
      result: {},
    });
    const frame = {
      frameId: "frame-1",
      session: { send },
    } as unknown as Frame;
    const resolver = new FrameSelectorResolver(frame);

    await expect(resolver.evaluateXPathElement("countXPathMatchesMainWorld()", 1)).resolves.toBeNull();
  });
});
