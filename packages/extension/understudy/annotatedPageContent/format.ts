import type { ContentNodeJson } from "./common_quality_data_pb.js";
import type { ApcTarget } from "./targets.js";
import type { Progress } from "../progress.js";
import type { AnnotatedPageContent } from "./index.js";
import { isDisabled, isRedacted, type ApcAction } from "./actions.js";
import { filterAnnotatedPageContent, type ApcNode } from "./filter.js";

/** Format a capture as a deterministic outline. Every retained node with resolved DOM identity receives its ID. */
export function formatAnnotatedPageContent(
  content: AnnotatedPageContent,
  actions: readonly ApcAction[] = [],
  progress?: Progress,
  targets?: ReadonlyMap<ContentNodeJson, ApcTarget>,
): string {
  const nodes = filterAnnotatedPageContent(content, actions, progress);
  const lines: string[] = [];
  for (const node of nodes) {
    progress?.throwIfStopped();
    appendNode(lines, node, actions.length > 0, targets?.get(node.source)?.id, progress);
  }
  progress?.throwIfStopped();
  return lines.join("\n");
}

function appendNode(
  lines: string[],
  node: ApcNode,
  compact: boolean,
  id?: string,
  progress?: Progress,
): void {
  const attributes = node.source.contentAttributes;
  const details: string[] = [];
  const add = (name: string, value?: string) => {
    if (value !== undefined && (value !== "" || name === "value"))
      details.push(`${name}=${quote(value)}`);
  };
  const control = attributes?.formControlData;
  const redacted = isRedacted(attributes);
  const type =
    control?.formControlType !== undefined
      ? enumLabel(control.formControlType, "FORM_CONTROL_TYPE_")
      : compact && attributes?.ariaRole !== undefined
        ? enumLabel(attributes.ariaRole, "AX_ROLE_")
        : enumLabel(attributes?.attributeType, "CONTENT_ATTRIBUTE_");
  if (!compact) {
    add("label", attributes?.label);
    add("caption", attributes?.imageData?.imageCaption ?? attributes?.tableData?.tableName);
  }
  if (!compact || !node.label) add("name", control?.fieldName ?? attributes?.formData?.formName);
  if (!redacted) add("value", control?.fieldValue);
  add("placeholder", control?.placeholder);
  if (
    control?.isChecked !== undefined &&
    (control.formControlType === "FORM_CONTROL_TYPE_INPUT_CHECKBOX" ||
      control.formControlType === "FORM_CONTROL_TYPE_INPUT_RADIO")
  )
    details.push(control.isChecked ? "checked" : "unchecked");
  if (control?.isRequired) details.push("required");
  if (control?.isReadonly) details.push("readonly");
  if (attributes && isDisabled(attributes)) details.push("disabled");
  if (redacted) details.push("redacted");
  if (!compact) {
    for (const role of attributes?.annotatedRoles ?? [])
      details.push(enumLabel(role, "ANNOTATED_ROLE_"));
    if (attributes?.ariaRole !== undefined)
      details.push(`role=${enumLabel(attributes.ariaRole, "AX_ROLE_")}`);
  }
  const reasons = attributes?.interactionInfo?.clickabilityReasons ?? [];
  if (reasons.includes("CLICKABILITY_REASON_ARIA_EXPANDED_TRUE")) details.push("expanded");
  if (reasons.includes("CLICKABILITY_REASON_ARIA_EXPANDED_FALSE")) details.push("collapsed");
  const frame = node.depth === 0 ? node.frame.data : attributes?.iframeData?.frameData;
  if (!compact) {
    add("title", frame?.title);
  }
  const redactedFrame = attributes?.iframeData?.redactedFrameMetadata;
  if (redactedFrame) details.push(`redacted-frame=${enumLabel(redactedFrame.reason, "REASON_")}`);
  const text =
    compact || control
      ? node.label
      : redacted
        ? undefined
        : (attributes?.textData?.textContent ?? attributes?.svgRootData?.innerText);
  const indent = compact ? "" : "  ".repeat(node.depth);
  lines.push(
    `${indent}${id ? `[${id}] ` : ""}${type}${text ? `: ${quote(text)}` : ""}${details.length ? ` [${details.join("; ")}]` : ""}`,
  );
  if (redacted) return;
  // Options are APC metadata rather than child nodes. Do not invent absent values or states.
  for (const option of control?.selectOptions ?? []) {
    progress?.throwIfStopped();
    const state: string[] = [];
    if (option.value !== undefined) state.push(`value=${quote(option.value)}`);
    if (option.isSelected !== undefined) state.push(option.isSelected ? "selected" : "unselected");
    if (option.isDisabled) state.push("disabled");
    lines.push(
      `${indent}  option${option.text !== undefined ? `: ${quote(option.text)}` : ""}${state.length ? ` [${state.join("; ")}]` : ""}`,
    );
  }
}

function enumLabel(value: string | number | undefined, prefix: string): string {
  return String(value ?? "unknown")
    .replace(prefix, "")
    .toLowerCase();
}

function quote(value: string): string {
  return JSON.stringify(value.replace(/\s+/gu, " ").trim());
}
