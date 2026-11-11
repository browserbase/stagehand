import { describe, expect, it, vi } from "vitest";
import { formatAnnotatedPageContent } from "./format.js";
import { resolveAnnotatedPageContentTargets } from "./targets.js";
import type { AnnotatedPageContent } from "./index.js";
import type { Page } from "../page.js";
import type { Frame } from "../frame.js";
import { Progress } from "../progress.js";
import { resolveContentFrame } from "../frameLocator.js";

vi.mock("../frameLocator.js", () => ({ resolveContentFrame: vi.fn() }));

describe("APC target identity", () => {
  it("binds DOM nodes to their owning frame without inventing IDs for missing identity", async () => {
    const rootFrame = { frameId: "root" } as Frame;
    const childFrame = { frameId: "child" } as Frame;
    const mainNode = {
      contentAttributes: {
        commonAncestorDomNodeId: 42,
        attributeType: "CONTENT_ATTRIBUTE_ANCHOR" as const,
        interactionInfo: { isDisabled: true },
      },
    };
    const childNode = {
      contentAttributes: {
        commonAncestorDomNodeId: 42,
        attributeType: "CONTENT_ATTRIBUTE_TEXT" as const,
        textData: { textContent: "Child text" },
      },
    };
    const missingOwnerChild = { contentAttributes: { commonAncestorDomNodeId: 43 } };
    const anonymous = {};
    const content: AnnotatedPageContent = {
      rootNode: {
        childrenNodes: [
          mainNode,
          anonymous,
          {
            contentAttributes: {
              attributeType: "CONTENT_ATTRIBUTE_IFRAME",
              commonAncestorDomNodeId: 10,
            },
            childrenNodes: [childNode],
          },
          {
            contentAttributes: { attributeType: "CONTENT_ATTRIBUTE_IFRAME" },
            childrenNodes: [missingOwnerChild],
          },
        ],
      },
    };
    const page = {
      mainFrame: () => rootFrame,
      getOrdinal: (id: string) => (id === "root" ? 0 : 1),
    } as unknown as Page;
    vi.mocked(resolveContentFrame).mockResolvedValue(childFrame);
    const progress = new Progress("apc", 1_000);
    try {
      const targets = await resolveAnnotatedPageContentTargets(page, content, progress);
      expect(targets.get(mainNode)).toEqual({ id: "0-42", frame: rootFrame, backendNodeId: 42 });
      expect(targets.get(childNode)).toEqual({ id: "1-42", frame: childFrame, backendNodeId: 42 });
      const output = formatAnnotatedPageContent(content, [], progress, targets);
      expect(output).toContain("[0-42] anchor [disabled]");
      expect(output).toContain('[1-42] text: "Child text"');
      expect(output).toContain("[0-10] iframe");
      expect(targets.has(anonymous)).toBe(false);
      expect(targets.has(missingOwnerChild)).toBe(false);
      expect(resolveContentFrame).toHaveBeenCalledExactlyOnceWith(page, rootFrame, 10, progress);
    } finally {
      progress.dispose();
    }
  });
});
