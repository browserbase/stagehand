import { describe, expect, it, vi } from "vitest";
import { Progress } from "../progress.js";
import { controls, control, text } from "./fixtures/controls.js";
import { filterAnnotatedPageContent } from "./filter.js";
import { formatAnnotatedPageContent } from "./format.js";
import { prepareAnnotatedPageContentQuery } from "./query.js";
import type { ApcAction } from "./actions.js";
import type { AnnotatedPageContent } from "./index.js";

function formatContent(
  content: AnnotatedPageContent,
  actions: readonly ApcAction[] = [],
  progress?: Progress,
): string {
  return formatAnnotatedPageContent(
    prepareAnnotatedPageContentQuery(content, actions, progress),
    progress,
  );
}

describe("APC filtering and formatting", () => {
  it("folds associated labels into targets without ancestor containers or unrelated text", () => {
    expect(formatContent(controls, ["fill"])).toBe(
      'input_email: "Email address" [value=""; placeholder="you@example.com"; required]',
    );
  });

  it("returns only the button on a page otherwise full of unrelated text", () => {
    const content: AnnotatedPageContent = {
      rootNode: {
        childrenNodes: [
          text("Random introduction"),
          {
            ...control("FORM_CONTROL_TYPE_BUTTON_BUTTON", "continue"),
            childrenNodes: [text("Continue")],
          },
          text("Random footer"),
        ],
      },
    };
    expect(formatContent(content, ["click"])).toBe('button_button: "Continue"');
  });

  it("uses OR semantics, deduplicates overlaps, and preserves DOM identity", () => {
    const fill = filterAnnotatedPageContent(controls, ["fill"]).filter((node) => node.target);
    const combined = filterAnnotatedPageContent(controls, ["fill", "type", "select", "fill"]);
    expect(
      combined
        .filter((node) => node.target)
        .map((node) => node.source.contentAttributes?.formControlData?.fieldName),
    ).toEqual(["email", "plan"]);
    expect(combined.filter((node) => node.source === fill[0]!.source)).toHaveLength(1);
    expect(fill[0]!.frame.data?.documentIdentifier?.serializedToken).toBe("main-document");
    expect(fill[0]!.source.contentAttributes?.commonAncestorDomNodeId).toBe(42);
  });

  it("preserves button descendant text, image captions, and checkbox state", () => {
    const output = formatContent(controls, ["click"]);
    expect(output).toContain('button: "Pay \\"now\\" Card"');
    expect(output).toContain('input_checkbox: "Accept terms" [unchecked]');
    expect(output).not.toContain("text:");
    expect(output).not.toContain("image [");
    expect(output).not.toContain("Unrelated");
    expect(output).not.toContain('name="disabled"');
  });

  it("renders select options and their explicit states without inventing missing metadata", () => {
    const output = formatContent(controls, ["select"]);
    expect(output).toContain(
      [
        'select_one [name="plan"]',
        '  option: "Basic" [value="basic"; selected]',
        '  option: "Pro" [value="pro"; unselected; disabled]',
        '  option: "Unknown state"',
      ].join("\n"),
    );
    expect(output).not.toContain("Email");
  });

  it("returns the full tree for omitted or empty filters and an empty string for no matches", () => {
    const output = formatContent(controls);
    expect(output).toBe(formatContent(controls, []));
    expect(output).toContain("Unrelated sale");
    expect(output).toContain('name="disabled"; disabled');
    expect(formatContent(controls, ["upload"])).toBe("");
    expect(formatContent({})).toBe("");
    expect(formatContent(controls)).toBe(output);
  });

  it("resolves labels within their owning document without emitting frame metadata", () => {
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
    const output = formatContent(content, ["fill"]);
    expect(output.split("\n")).toHaveLength(1);
    expect(output).not.toContain("iframe");
    expect(output).not.toContain("https://payment.test/");
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
    const output = formatContent(content, ["fill"]);
    expect(output).toContain('input_text: "Name"');
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
    expect(formatContent(content, ["scroll"])).toBe("root");
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
    const output = formatContent(content);
    expect(output).toContain('input_password [name="password"; redacted]');
    expect(output).toContain("iframe [redacted-frame=cross_origin]");
    expect(output).not.toContain("must not appear");
    expect(output).not.toContain("omitted frame content");
    expect(formatContent(content, ["fill"])).not.toContain("iframe");
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
    expect(formatContent(content, ["fill", "click"])).toBe("");
    expect(formatContent(content)).toContain("Unknown");
  });

  it("drops control internals and empty wrappers while preserving independent controls", () => {
    const input = {
      ...control("FORM_CONTROL_TYPE_INPUT_TEXT", "email", { label: "Email" }),
      childrenNodes: [
        {
          contentAttributes: {
            attributeType: "CONTENT_ATTRIBUTE_CONTAINER" as const,
            interactionInfo: { clickabilityReasons: ["CLICKABILITY_REASON_EDITABLE" as const] },
          },
          childrenNodes: [text("")],
        },
      ],
    };
    const content: AnnotatedPageContent = {
      rootNode: {
        contentAttributes: { attributeType: "CONTENT_ATTRIBUTE_ROOT" },
        childrenNodes: [
          {
            contentAttributes: { attributeType: "CONTENT_ATTRIBUTE_CONTAINER" },
            childrenNodes: [
              input,
              {
                contentAttributes: { attributeType: "CONTENT_ATTRIBUTE_CONTAINER" },
                childrenNodes: [
                  {
                    contentAttributes: {
                      attributeType: "CONTENT_ATTRIBUTE_CONTAINER",
                      ariaRole: "AX_ROLE_BUTTON",
                      label: "Custom button",
                      interactionInfo: {
                        clickabilityReasons: ["CLICKABILITY_REASON_CLICK_HANDLER"],
                      },
                    },
                  },
                ],
              },
              {
                contentAttributes: {
                  attributeType: "CONTENT_ATTRIBUTE_CONTAINER",
                  interactionInfo: {
                    clickabilityReasons: [
                      "CLICKABILITY_REASON_MOUSE_ENTER",
                      "CLICKABILITY_REASON_CLICK_HANDLER",
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
    };
    const filtered = formatContent(content, ["click", "fill", "hover"]);
    expect(filtered).toBe('input_text: "Email"\nbutton: "Custom button"');
    const full = filterAnnotatedPageContent(content);
    expect(full.filter((node) => node.source === input)).toHaveLength(1);
    expect(
      full.filter(
        (node) => node.source.contentAttributes?.attributeType === "CONTENT_ATTRIBUTE_CONTAINER",
      ),
    ).toHaveLength(2); // The branching wrapper and the independent ARIA button.
    expect(formatContent(content)).not.toContain('text: ""');
  });

  it("omits URL metadata from both full and filtered output", () => {
    const content: AnnotatedPageContent = {
      mainFrameData: { url: "https://example.test/?very=long" },
      rootNode: {
        contentAttributes: { attributeType: "CONTENT_ATTRIBUTE_ROOT" },
        childrenNodes: [
          {
            contentAttributes: {
              attributeType: "CONTENT_ATTRIBUTE_ANCHOR",
              anchorData: { url: "https://example.test/destination?tracking=long" },
              interactionInfo: {},
            },
            childrenNodes: [text("Destination")],
          },
        ],
      },
    };
    for (const actions of [[], ["click"]] as const) {
      const output = formatContent(content, actions);
      expect(output).toContain("Destination");
      expect(output).not.toContain("https://");
      expect(output).not.toContain("url=");
    }
  });

  it("honors the same deadline during processing", () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now++);
    const progress = new Progress("apc", 10);
    try {
      expect(() => formatContent(controls, ["click"], progress)).toThrow(/apc timed out/);
    } finally {
      progress.dispose();
      clock.mockRestore();
    }
  });
});
