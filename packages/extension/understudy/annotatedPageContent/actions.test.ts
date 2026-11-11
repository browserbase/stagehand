import { describe, expect, it } from "vitest";
import { classifyActions, type ApcAction } from "./actions.js";
import { control } from "./fixtures/controls.js";
import type { ClickabilityReasonJson, FormControlTypeJson } from "./common_quality_data_pb.js";

describe("APC action classification", () => {
  it.each<FormControlTypeJson>([
    "FORM_CONTROL_TYPE_INPUT_TEXT",
    "FORM_CONTROL_TYPE_INPUT_EMAIL",
    "FORM_CONTROL_TYPE_INPUT_NUMBER",
    "FORM_CONTROL_TYPE_INPUT_PASSWORD",
    "FORM_CONTROL_TYPE_INPUT_SEARCH",
    "FORM_CONTROL_TYPE_INPUT_TELEPHONE",
    "FORM_CONTROL_TYPE_INPUT_URL",
    "FORM_CONTROL_TYPE_TEXT_AREA",
    "FORM_CONTROL_TYPE_CONTENT_EDITABLE",
  ])("supports filling and typing into %s", (type) => {
    expect(classifyActions(control(type, "field").contentAttributes)).toEqual([
      "click",
      "fill",
      "type",
    ]);
  });

  it.each<FormControlTypeJson>([
    "FORM_CONTROL_TYPE_INPUT_COLOR",
    "FORM_CONTROL_TYPE_INPUT_DATE",
    "FORM_CONTROL_TYPE_INPUT_DATETIME_LOCAL",
    "FORM_CONTROL_TYPE_INPUT_MONTH",
    "FORM_CONTROL_TYPE_INPUT_RANGE",
    "FORM_CONTROL_TYPE_INPUT_TIME",
    "FORM_CONTROL_TYPE_INPUT_WEEK",
  ])("fills %s using value assignment, without claiming text input", (type) => {
    const node = control(type, "field", {
      interactionInfo: { clickabilityReasons: ["CLICKABILITY_REASON_EDITABLE"] },
    });
    expect(classifyActions(node.contentAttributes)).toEqual(["click", "fill"]);
  });

  it.each<[FormControlTypeJson, ApcAction[]]>([
    ["FORM_CONTROL_TYPE_INPUT_CHECKBOX", ["click"]],
    ["FORM_CONTROL_TYPE_INPUT_RADIO", ["click"]],
    ["FORM_CONTROL_TYPE_BUTTON_SUBMIT", ["click"]],
    ["FORM_CONTROL_TYPE_SELECT_ONE", ["click", "select"]],
    ["FORM_CONTROL_TYPE_SELECT_MULTIPLE", ["click", "select"]],
    ["FORM_CONTROL_TYPE_INPUT_FILE", ["click", "upload"]],
    ["FORM_CONTROL_TYPE_INPUT_HIDDEN", []],
    ["FORM_CONTROL_TYPE_FIELDSET", []],
    ["FORM_CONTROL_TYPE_OUTPUT", []],
    ["FORM_CONTROL_TYPE_UNSPECIFIED", []],
  ])("classifies native %s", (type, expected) => {
    expect(classifyActions(control(type, "field").contentAttributes)).toEqual(expected);
  });

  it("recognizes a contenteditable region without form metadata", () => {
    expect(
      classifyActions({
        interactionInfo: { clickabilityReasons: ["CLICKABILITY_REASON_EDITABLE"] },
      }),
    ).toEqual(["click", "fill", "type"]);
  });

  it("keeps readonly fields clickable but not writable", () => {
    expect(
      classifyActions(
        control("FORM_CONTROL_TYPE_INPUT_TEXT", "field", {
          formControlData: { isReadonly: true },
          interactionInfo: { clickabilityReasons: ["CLICKABILITY_REASON_EDITABLE"] },
        }).contentAttributes,
      ),
    ).toEqual(["click"]);
  });

  it("excludes disabled and aria-disabled controls even when actionable signals are present", () => {
    for (const interactionInfo of [
      { isDisabled: true },
      {
        isDisabled: false,
        interactionDisabledReasons: ["INTERACTION_DISABLED_REASON_ARIA_DISABLED" as const],
      },
      { interactionDisabledReasons: ["INTERACTION_DISABLED_REASON_DISABLED" as const] },
      { interactionDisabledReasons: ["INTERACTION_DISABLED_REASON_POINTER_EVENTS_NONE" as const] },
      { interactionDisabledReasons: ["INTERACTION_DISABLED_REASON_VISUALLY_UNREACHABLE" as const] },
    ]) {
      expect(
        classifyActions(
          control("FORM_CONTROL_TYPE_INPUT_TEXT", "field", { interactionInfo }).contentAttributes,
        ),
      ).toEqual([]);
    }
  });

  it.each<[ClickabilityReasonJson, ApcAction[]]>([
    ["CLICKABILITY_REASON_CLICK_HANDLER", ["click"]],
    ["CLICKABILITY_REASON_MOUSE_CLICK", ["click"]],
    ["CLICKABILITY_REASON_CURSOR_POINTER", ["click"]],
    ["CLICKABILITY_REASON_ARIA_ROLE", ["click"]],
    ["CLICKABILITY_REASON_ARIA_TOGGLE", ["click"]],
    ["CLICKABILITY_REASON_MOUSE_HOVER", ["hover"]],
    ["CLICKABILITY_REASON_MOUSE_ENTER", ["hover"]],
    ["CLICKABILITY_REASON_MOUSE_OVER", ["hover"]],
    ["CLICKABILITY_REASON_HOVER_PSEUDO_CLASS", ["hover"]],
    ["CLICKABILITY_REASON_KEY_EVENTS", []],
    ["CLICKABILITY_REASON_TAB_INDEX", []],
    ["CLICKABILITY_REASON_AUTOCOMPLETE", []],
  ])("interprets %s without confusing hover or focus with click", (reason, expected) => {
    expect(
      classifyActions({ interactionInfo: { isFocusable: true, clickabilityReasons: [reason] } }),
    ).toEqual(expected);
  });

  it("requires user scrolling, not merely overflow geometry", () => {
    expect(
      classifyActions({
        interactionInfo: { scrollerInfo: { scrollingBounds: { width: 200, height: 500 } } },
      }),
    ).toEqual([]);
    expect(
      classifyActions({ interactionInfo: { scrollerInfo: { userScrollableVertical: true } } }),
    ).toEqual(["scroll"]);
    expect(
      classifyActions({
        interactionInfo: {
          scrollerInfo: { userScrollableHorizontal: true, userScrollableVertical: false },
        },
      }),
    ).toEqual(["scroll"]);
  });

  it("does not invent actions from missing interaction metadata, generic ARIA roles", () => {
    expect(classifyActions()).toEqual([]);
    expect(
      classifyActions({ formControlData: { formControlType: "FORM_CONTROL_TYPE_INPUT_TEXT" } }),
    ).toEqual([]);
    expect(classifyActions({ ariaRole: "AX_ROLE_COMBOBOXSELECT", interactionInfo: {} })).toEqual(
      [],
    );
  });

  it("recognizes anchors while ignoring non-activation advisory styling", () => {
    expect(
      classifyActions({
        attributeType: "CONTENT_ATTRIBUTE_ANCHOR",
        anchorData: { url: "/next" },
        interactionInfo: {
          interactionDisabledReasons: ["INTERACTION_DISABLED_REASON_CURSOR_NOT_ALLOWED"],
        },
      }),
    ).toEqual(["click"]);
  });
});
