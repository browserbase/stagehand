import type { VariableValue } from "@browserbasehq/stagehand-protocol/types";

export function resolveVariableValue(v: VariableValue): string {
  if (typeof v === "object" && v !== null && "value" in v) {
    return String(v.value);
  }
  return String(v);
}
