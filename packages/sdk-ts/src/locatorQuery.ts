import {
  decodeLocatorQuery,
  encodeLocatorQuery,
  type AriaRole,
  type GetByTextOptions,
  type QueryStep,
  type TextPattern,
} from "@browserbasehq/stagehand-protocol/locator-query";
import type * as ProtocolTypes from "@browserbasehq/stagehand-protocol/locator-query";
import type { LocatorDescriptor } from "@browserbasehq/stagehand-protocol/types";

export type { AriaRole, GetByTextOptions };
export type GetByRoleOptions = Omit<ProtocolTypes.GetByRoleOptions, "name" | "description"> & {
  name?: string | RegExp;
  description?: string | RegExp;
};

function textPattern(text: string | RegExp): TextPattern {
  return text instanceof RegExp ? { source: text.source, flags: text.flags } : text;
}

export function roleQueryStep(role: AriaRole, options?: GetByRoleOptions): QueryStep {
  return {
    kind: "role",
    role,
    options: options && {
      ...options,
      name: options.name === undefined ? undefined : textPattern(options.name),
      description: options.description === undefined ? undefined : textPattern(options.description),
    },
  };
}

export function textQueryStep(text: string | RegExp, options?: GetByTextOptions): QueryStep {
  return { ...options, kind: "text", text: textPattern(text) };
}

/** Appending a descendant must preserve an earlier nth selection in the query order. */
export function appendLocatorStep(
  descriptor: LocatorDescriptor,
  step: QueryStep,
): LocatorDescriptor {
  const { selector, nth, ...page } = descriptor;
  const steps = decodeLocatorQuery(selector) ?? [{ kind: "selector" as const, selector }];
  if (nth !== undefined) steps.push({ kind: "nth", index: nth });
  return { ...page, selector: encodeLocatorQuery([...steps, step]) };
}
