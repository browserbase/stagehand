import { describe, expect, it } from "vitest";
import { attributeLabelText } from "../dom/locatorScripts/textLabels.js";

const element = (props: Record<string, unknown>) => props as unknown as Element;

describe("attributeLabelText", () => {
  it("reads the label of button-like inputs from value", () => {
    expect(
      attributeLabelText(element({ tagName: "INPUT", type: "submit", value: "Publish" })),
    ).toBe("Publish");
    expect(attributeLabelText(element({ tagName: "INPUT", type: "reset", value: "Discard" }))).toBe(
      "Discard",
    );
    expect(
      attributeLabelText(element({ tagName: "INPUT", type: "button", value: "Preview" })),
    ).toBe("Preview");
  });

  it("treats the value of every other input as data, not as a label", () => {
    expect(attributeLabelText(element({ tagName: "INPUT", type: "text", value: "typed" }))).toBe(
      "",
    );
    expect(attributeLabelText(element({ tagName: "INPUT", type: "image", value: "Send" }))).toBe(
      "",
    );
    expect(attributeLabelText(element({ tagName: "INPUT", type: "file", value: "a.txt" }))).toBe(
      "",
    );
  });

  it("has no label to offer when value is absent", () => {
    expect(attributeLabelText(element({ tagName: "INPUT", type: "submit" }))).toBe("");
  });

  it("trims the label and takes the type case-insensitively", () => {
    // The browser normalizes `type` on the property already; the lowercasing is a safety net
    // for anything that reaches this function with the raw attribute instead.
    expect(
      attributeLabelText(element({ tagName: "INPUT", type: "SUBMIT", value: "  Shout  " })),
    ).toBe("Shout");
  });

  it("leaves elements that hold their text in the DOM to the caller", () => {
    expect(attributeLabelText(element({ tagName: "BUTTON", textContent: "Save" }))).toBeNull();
    expect(attributeLabelText(element({ tagName: "TEXTAREA", value: "Draft body" }))).toBeNull();
  });
});
