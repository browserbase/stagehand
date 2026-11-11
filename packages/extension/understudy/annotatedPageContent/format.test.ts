import { describe, expect, it, vi } from "vitest";
import { Progress } from "../progress.js";
import { controls, control, text } from "./fixtures/controls.js";
import { filterAnnotatedPageContent } from "./filter.js";
import { formatAnnotatedPageContent } from "./format.js";
import type { AnnotatedPageContent } from "./index.js";

describe("APC filtering and formatting", () => {
  it("retains external labels and ancestor context without unrelated branches or target markers", () => {
    expect(formatAnnotatedPageContent(controls, ["fill"])).toBe(
      [
        'root [frame-url="https://shop.test/"; title="Checkout"]',
        '  form [name="Checkout"]',
        "    container",
        '      text: "Email address"',
        '    [apc-7] input_email [name="email"; value=""; placeholder="you@example.com"; required]',
      ].join("\n"),
    );
  });

  it("uses OR semantics, deduplicates overlaps, and keeps capture-local IDs stable", () => {
    const fill = filterAnnotatedPageContent(controls, ["fill"]).filter((node) => node.target);
    const combined = filterAnnotatedPageContent(controls, ["fill", "type", "select", "fill"]);
    expect(
      combined
        .filter((node) => node.target)
        .map((node) => node.source.contentAttributes?.formControlData?.fieldName),
    ).toEqual(["email", "plan"]);
    expect(combined.find((node) => node.source === fill[0]!.source)?.id).toBe(fill[0]!.id);
    expect(fill[0]!.frame.data?.documentIdentifier?.serializedToken).toBe("main-document");
    expect(fill[0]!.source.contentAttributes?.commonAncestorDomNodeId).toBe(42);
  });

  it("preserves button descendant text, image captions, and checkbox state", () => {
    const output = formatAnnotatedPageContent(controls, ["click"]);
    expect(output).toContain('text: "Pay \\"now\\""');
    expect(output).toContain('image [caption="Card"]');
    expect(output).toContain('input_checkbox [label="Accept terms"; name="terms"; unchecked]');
    expect(output).not.toContain("Unrelated");
    expect(output).not.toContain('name="disabled"');
  });

  it("renders select options and their explicit states without inventing missing metadata", () => {
    const output = formatAnnotatedPageContent(controls, ["select"]);
    expect(output).toContain(
      [
        '    [apc-10] select_one [name="plan"]',
        '      option: "Basic" [value="basic"; selected]',
        '      option: "Pro" [value="pro"; unselected; disabled]',
        '      option: "Unknown state"',
      ].join("\n"),
    );
    expect(output).not.toContain("Email");
  });

  it("returns the full tree for omitted or empty filters and an empty string for no matches", () => {
    const output = formatAnnotatedPageContent(controls);
    expect(output).toBe(formatAnnotatedPageContent(controls, []));
    expect(output).toContain("Unrelated sale");
    expect(output).toContain('name="disabled"; disabled');
    expect(formatAnnotatedPageContent(controls, ["upload"])).toBe("");
    expect(formatAnnotatedPageContent({})).toBe("");
    expect(formatAnnotatedPageContent(controls)).toBe(output);
  });

  it("keeps frame boundaries and resolves labels within their owning document", () => {
    const content: AnnotatedPageContent = {
      rootNode: {
        childrenNodes: [
          {
            contentAttributes: { labelForDomNodeId: 1 },
            childrenNodes: [text("Wrong label in parent")],
          },
          {
            contentAttributes: {
              attributeType: "CONTENT_ATTRIBUTE_IFRAME",
              iframeData: {
                frameData: {
                  url: "https://payment.test/",
                  documentIdentifier: { serializedToken: "child-document" },
                },
              },
            },
            childrenNodes: [
              {
                contentAttributes: {
                  attributeType: "CONTENT_ATTRIBUTE_CONTAINER",
                  labelForDomNodeId: 1,
                },
                childrenNodes: [text("Cardholder")],
              },
              control("FORM_CONTROL_TYPE_INPUT_TEXT", "cardholder", { commonAncestorDomNodeId: 1 }),
            ],
          },
        ],
      },
    };
    const output = formatAnnotatedPageContent(content, ["fill"]);
    expect(output).toContain('iframe [frame-url="https://payment.test/"]');
    expect(output).toContain("Cardholder");
    expect(output).not.toContain("Wrong label");
    const target = filterAnnotatedPageContent(content, ["fill"]).find((node) => node.target)!;
    expect(target.frame.data?.documentIdentifier?.serializedToken).toBe("child-document");
    expect(target.frame.id).toBe("frame-2");
  });

  it("retains nested labels but excludes unrelated interactive descendants", () => {
    const content: AnnotatedPageContent = {
      rootNode: {
        childrenNodes: [
          {
            contentAttributes: {
              attributeType: "CONTENT_ATTRIBUTE_CONTAINER",
              labelForDomNodeId: 2,
            },
            childrenNodes: [
              text("Name"),
              control("FORM_CONTROL_TYPE_INPUT_TEXT", "name", { commonAncestorDomNodeId: 2 }),
              control("FORM_CONTROL_TYPE_BUTTON_BUTTON", "help"),
            ],
          },
        ],
      },
    };
    const output = formatAnnotatedPageContent(content, ["fill"]);
    expect(output).toContain('text: "Name"');
    expect(output).not.toContain('name="help"');
  });

  it("does not retain a whole page merely because its root is scrollable", () => {
    const content: AnnotatedPageContent = {
      rootNode: {
        contentAttributes: {
          attributeType: "CONTENT_ATTRIBUTE_ROOT",
          interactionInfo: { scrollerInfo: { userScrollableVertical: true } },
        },
        childrenNodes: [text("Unrelated body"), control("FORM_CONTROL_TYPE_INPUT_TEXT", "field")],
      },
    };
    expect(formatAnnotatedPageContent(content, ["scroll"])).toBe("[apc-1] root");
  });

  it("keeps redaction visible without exposing or reconstructing redacted contents", () => {
    const content: AnnotatedPageContent = {
      rootNode: {
        childrenNodes: [
          control("FORM_CONTROL_TYPE_INPUT_PASSWORD", "password", {
            redactionDecision: "REDACTION_DECISION_REDACTED_HAS_BEEN_PASSWORD",
            formControlData: { fieldValue: "must not appear" },
          }),
          {
            contentAttributes: {
              attributeType: "CONTENT_ATTRIBUTE_IFRAME",
              iframeData: { redactedFrameMetadata: { reason: "REASON_CROSS_ORIGIN" } },
              interactionInfo: { clickabilityReasons: ["CLICKABILITY_REASON_CLICK_HANDLER"] },
            },
            childrenNodes: [text("omitted frame content")],
          },
        ],
      },
    };
    const output = formatAnnotatedPageContent(content);
    expect(output).toContain('input_password [name="password"; redacted]');
    expect(output).toContain("iframe [redacted-frame=cross_origin]");
    expect(output).not.toContain("must not appear");
    expect(output).not.toContain("omitted frame content");
    expect(formatAnnotatedPageContent(content, ["fill"])).not.toContain("iframe");
  });

  it("does not guess targets in hidden subtrees or nodes with missing metadata", () => {
    const content: AnnotatedPageContent = {
      rootNode: {
        childrenNodes: [
          {
            contentAttributes: { annotatedRoles: ["ANNOTATED_ROLE_CONTENT_HIDDEN"] },
            childrenNodes: [control("FORM_CONTROL_TYPE_INPUT_TEXT", "hidden")],
          },
          {
            contentAttributes: { attributeType: "CONTENT_ATTRIBUTE_CONTAINER" },
            childrenNodes: [text("Unknown")],
          },
        ],
      },
    };
    expect(formatAnnotatedPageContent(content, ["fill", "click"])).toBe("");
    expect(formatAnnotatedPageContent(content)).toContain("Unknown");
  });

  it("honors the same deadline during processing", () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now++);
    const progress = new Progress("apc", 10);
    try {
      expect(() => formatAnnotatedPageContent(controls, ["click"], progress)).toThrow(
        /apc timed out/,
      );
    } finally {
      progress.dispose();
      clock.mockRestore();
    }
  });
});
