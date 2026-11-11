import type {
  ContentAttributesJson,
  ClickabilityReasonJson,
  FormControlTypeJson,
} from "./common_quality_data_pb.js";

import type { ApcAction } from "@browserbasehq/stagehand-protocol/types";
export type { ApcAction } from "@browserbasehq/stagehand-protocol/types";

const textControls = new Set<FormControlTypeJson>([
  "FORM_CONTROL_TYPE_INPUT_EMAIL",
  "FORM_CONTROL_TYPE_INPUT_NUMBER",
  "FORM_CONTROL_TYPE_INPUT_PASSWORD",
  "FORM_CONTROL_TYPE_INPUT_SEARCH",
  "FORM_CONTROL_TYPE_INPUT_TELEPHONE",
  "FORM_CONTROL_TYPE_INPUT_TEXT",
  "FORM_CONTROL_TYPE_INPUT_URL",
  "FORM_CONTROL_TYPE_TEXT_AREA",
  "FORM_CONTROL_TYPE_CONTENT_EDITABLE",
]);
// Keep these aligned with fillElementValue in dom/locatorScripts/scripts.ts.
const valueControls = new Set<FormControlTypeJson>([
  "FORM_CONTROL_TYPE_INPUT_COLOR",
  "FORM_CONTROL_TYPE_INPUT_DATE",
  "FORM_CONTROL_TYPE_INPUT_DATETIME_LOCAL",
  "FORM_CONTROL_TYPE_INPUT_MONTH",
  "FORM_CONTROL_TYPE_INPUT_RANGE",
  "FORM_CONTROL_TYPE_INPUT_TIME",
  "FORM_CONTROL_TYPE_INPUT_WEEK",
]);
const clickReasons = new Set<ClickabilityReasonJson>([
  "CLICKABILITY_REASON_CLICKABLE_CONTROL",
  "CLICKABILITY_REASON_CLICK_HANDLER",
  "CLICKABILITY_REASON_MOUSE_CLICK",
  "CLICKABILITY_REASON_CURSOR_POINTER",
  "CLICKABILITY_REASON_ARIA_ROLE",
  "CLICKABILITY_REASON_ARIA_HAS_POPUP",
  "CLICKABILITY_REASON_ARIA_EXPANDED_TRUE",
  "CLICKABILITY_REASON_ARIA_EXPANDED_FALSE",
  "CLICKABILITY_REASON_ARIA_TOGGLE",
  "CLICKABILITY_REASON_ARIA_SELECTABLE",
]);
const nativeClickControls = new Set<FormControlTypeJson>([
  ...textControls,
  ...valueControls,
  "FORM_CONTROL_TYPE_INPUT_CHECKBOX",
  "FORM_CONTROL_TYPE_INPUT_RADIO",
  "FORM_CONTROL_TYPE_SELECT_ONE",
  "FORM_CONTROL_TYPE_SELECT_MULTIPLE",
  "FORM_CONTROL_TYPE_BUTTON_BUTTON",
  "FORM_CONTROL_TYPE_BUTTON_SUBMIT",
  "FORM_CONTROL_TYPE_BUTTON_RESET",
  "FORM_CONTROL_TYPE_BUTTON_POPOVER",
  "FORM_CONTROL_TYPE_INPUT_BUTTON",
  "FORM_CONTROL_TYPE_INPUT_FILE",
  "FORM_CONTROL_TYPE_INPUT_IMAGE",
  "FORM_CONTROL_TYPE_INPUT_RESET",
  "FORM_CONTROL_TYPE_INPUT_SUBMIT",
]);

export function isDisabled(attributes: ContentAttributesJson): boolean {
  const info = attributes.interactionInfo;
  return (
    info?.isDisabled === true ||
    (info?.interactionDisabledReasons ?? []).some(
      (reason) =>
        reason === "INTERACTION_DISABLED_REASON_DISABLED" ||
        reason === "INTERACTION_DISABLED_REASON_ARIA_DISABLED" ||
        reason === "INTERACTION_DISABLED_REASON_POINTER_EVENTS_NONE" ||
        reason === "INTERACTION_DISABLED_REASON_VISUALLY_UNREACHABLE",
    )
  );
}

/** Positive current APC signals only; focusability and legacy flags are insufficient. */
export function classifyActions(attributes?: ContentAttributesJson): ApcAction[] {
  if (
    !attributes?.interactionInfo ||
    isDisabled(attributes) ||
    attributes.annotatedRoles?.includes("ANNOTATED_ROLE_CONTENT_HIDDEN") ||
    attributes.iframeData?.redactedFrameMetadata
  )
    return [];
  const info = attributes.interactionInfo;
  const control = attributes.formControlData;
  const type = control?.formControlType;
  const reasons = info.clickabilityReasons ?? [];
  const has = (reason: ClickabilityReasonJson) => reasons.includes(reason);
  const editable = has("CLICKABILITY_REASON_EDITABLE");
  const writable = control?.isReadonly !== true;
  // An editable signal on a specialized native control must not turn it into a text input.
  const text =
    type !== undefined && type !== "FORM_CONTROL_TYPE_UNSPECIFIED"
      ? textControls.has(type)
      : editable;
  const actions: ApcAction[] = [];
  if (
    (type !== undefined && nativeClickControls.has(type)) ||
    (attributes.attributeType === "CONTENT_ATTRIBUTE_ANCHOR" && !!attributes.anchorData?.url) ||
    editable ||
    reasons.some((reason) => clickReasons.has(reason))
  )
    actions.push("click");
  if (writable && (text || (type !== undefined && valueControls.has(type)))) actions.push("fill");
  if (writable && text) actions.push("type");
  if (type === "FORM_CONTROL_TYPE_SELECT_ONE" || type === "FORM_CONTROL_TYPE_SELECT_MULTIPLE")
    actions.push("select");
  if (
    has("CLICKABILITY_REASON_MOUSE_ENTER") ||
    has("CLICKABILITY_REASON_MOUSE_OVER") ||
    has("CLICKABILITY_REASON_MOUSE_HOVER") ||
    has("CLICKABILITY_REASON_HOVER_PSEUDO_CLASS")
  )
    actions.push("hover");
  if (
    info.scrollerInfo?.userScrollableHorizontal === true ||
    info.scrollerInfo?.userScrollableVertical === true
  )
    actions.push("scroll");
  if (type === "FORM_CONTROL_TYPE_INPUT_FILE") actions.push("upload");
  return actions;
}

export function isRedacted(attributes?: ContentAttributesJson): boolean {
  const decision = attributes?.redactionDecision ?? attributes?.formControlData?.redactionDecision;
  return typeof decision === "string" && decision.startsWith("REDACTION_DECISION_REDACTED_");
}
