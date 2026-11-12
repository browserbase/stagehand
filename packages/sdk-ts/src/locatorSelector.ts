import {
  LocatorChainSchema,
  CssLocatorSelectorSchema,
  XPathLocatorSelectorSchema,
  TextLocatorSelectorSchema,
  PromptLocatorSelectorSchema,
} from "@browserbasehq/stagehand-protocol/schemas";
import type {
  LocatorChain,
  LocatorQuerySelector,
  LocatorStep,
} from "@browserbasehq/stagehand-protocol/types";

import { z } from "zod/v4";

/**
 * Preserve existing string interpretation, including iframe hops and deep XPath.
 * SDK-only input: normalized to a chain before crossing the wire.
 */
export const LegacyLocatorSelectorSchema = z
  .strictObject({
    type: z.literal("legacy"),
    value: z.string().min(1),
  })
  .meta({ id: "LegacyLocatorSelector" });

export const LocatorSelectorSchema = z
  .discriminatedUnion("type", [
    CssLocatorSelectorSchema,
    XPathLocatorSelectorSchema,
    TextLocatorSelectorSchema,
    PromptLocatorSelectorSchema,
    LegacyLocatorSelectorSchema,
  ])
  .meta({ id: "LocatorSelector" });

export type LegacyLocatorSelector = z.infer<typeof LegacyLocatorSelectorSchema>;
export type LocatorSelector = z.infer<typeof LocatorSelectorSchema>;

export type LocatorInput = string | LocatorSelector;

/** Interpret legacy syntax once, at the SDK boundary. Explicit engine values stay literal. */
export function normalizeLocatorSelector(input: LocatorInput): LocatorChain {
  const selector = LocatorSelectorSchema.parse(
    typeof input === "string" ? { type: "legacy", value: input } : input,
  );
  if (selector.type !== "legacy") {
    return { steps: [{ type: "query", selector }] };
  }
  const raw = selector.value.trim();
  const hops = raw
    .split(">>")
    .map((part) => part.trim())
    .filter(Boolean);
  if (hops.length > 1) return fromHops(hops.map(parseLegacyQuery));

  // Match the historical deep-XPath dispatch (including its case sensitivity).
  if (raw.startsWith("xpath=") || raw.startsWith("/")) {
    let path = raw.startsWith("xpath=") ? raw.slice(6).trim() : raw;
    if (!path.startsWith("/")) path = "/" + path;
    const tokens = [...path.matchAll(/(\/\/?)([^/]*)/g)]
      .map((match) => ({ axis: match[1]!, value: match[2]!.trim() }))
      .filter((token) => token.value);
    const queries: LocatorQuerySelector[] = [];
    let buffer = "";
    for (const [index, token] of tokens.entries()) {
      buffer += token.axis + token.value;
      const name = token.value.replace(/\[\d+\]\s*$/u, "").toLowerCase();
      if (/^i?frame(?:\[\d+\])?$/i.test(name) && index < tokens.length - 1) {
        queries.push({ type: "xpath", value: buffer });
        buffer = "";
      }
    }
    queries.push({ type: "xpath", value: buffer || "/" });
    return fromHops(queries);
  }
  return fromHops([parseLegacyQuery(raw)]);
}

function fromHops(selectors: LocatorQuerySelector[]): LocatorChain {
  return LocatorChainSchema.parse({
    steps: selectors.map((selector, index) => ({
      type: index === 0 ? "query" : "frame",
      selector,
      ...(index < selectors.length - 1 ? { nth: 0 } : {}),
    })),
  });
}

function parseLegacyQuery(raw: string): LocatorQuerySelector {
  const trimmed = raw.trim();
  if (/^text=/i.test(trimmed)) {
    let value = trimmed.slice(5).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    // Empty legacy CSS/text expressions previously matched no elements.
    return value ? { type: "text", value } : { type: "css", value: ":not(*)" };
  }
  if (/^xpath=/i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("(")) {
    return { type: "xpath", value: trimmed.replace(/^xpath=/i, "") || "/" };
  }
  const value = trimmed
    .replace(/^css=/i, "")
    .split(">>")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  return { type: "css", value: value || ":not(*)" };
}

export function withLocatorIndex(chain: LocatorChain, index: number): LocatorChain {
  const steps: LocatorStep[] = chain.steps.map((step, position) =>
    position === chain.steps.length - 1 ? { ...step, nth: index } : step,
  );
  return LocatorChainSchema.parse({ steps });
}
