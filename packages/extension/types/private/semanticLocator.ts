import { z } from "zod";
import {
  encodeWireValue,
  wireSchema,
} from "@browserbasehq/stagehand-protocol/json-rpc/wire-casing";

const SEMANTIC_SELECTOR_PREFIX = "internal:locator=";

export const AriaRoleSchema = z.enum([
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "meter",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
]);

export const TextPatternSchema = z.union([
  z.string(),
  z
    .strictObject({ source: z.string(), flags: z.string().optional() })
    .superRefine((pattern, ctx) => {
      try {
        new RegExp(pattern.source, pattern.flags);
      } catch (error) {
        ctx.addIssue({ code: "custom", message: `Invalid regular expression: ${String(error)}` });
      }
    }),
]);

export const RoleOptionsSchema = z.strictObject({
  name: TextPatternSchema.optional(),
  description: TextPatternSchema.optional(),
  exact: z.boolean().optional(),
  includeHidden: z.boolean().optional(),
  disabled: z.boolean().optional(),
  expanded: z.boolean().optional(),
  selected: z.boolean().optional(),
  checked: z.boolean().optional(),
  pressed: z.boolean().optional(),
  level: z.number().int().positive().optional(),
});

export const QueryStepSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("selector"),
    selector: z
      .string()
      .min(1)
      .refine((selector) => !isSemanticSelector(selector.trim()), {
        message: "Selector steps cannot contain another semantic locator query",
      }),
  }),
  z.strictObject({
    kind: z.literal("role"),
    role: AriaRoleSchema,
    options: RoleOptionsSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("text"),
    text: TextPatternSchema,
    exact: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal("nth"), index: z.number().int().nonnegative() }),
]);

export const SemanticLocatorQuerySchema = z
  .array(QueryStepSchema)
  .min(1)
  .refine((steps) => steps[0]?.kind !== "nth", {
    message: "A semantic locator query must start with a selector, role, or text step",
  });

export type AriaRole = z.infer<typeof AriaRoleSchema>;
export type TextPattern = z.infer<typeof TextPatternSchema>;
export type RoleOptions = z.infer<typeof RoleOptionsSchema>;
export type QueryStep = z.infer<typeof QueryStepSchema>;

export function isSemanticSelector(selector: string): boolean {
  return selector.startsWith(SEMANTIC_SELECTOR_PREFIX);
}

/** The private selector envelope keeps user text separate from legacy iframe-hop syntax. */
export function encodeLocatorQuery(steps: readonly QueryStep[]): string {
  const query = JSON.parse(JSON.stringify(SemanticLocatorQuerySchema.parse(steps)));
  return SEMANTIC_SELECTOR_PREFIX + JSON.stringify(encodeWireValue(query));
}

/** Ordinary selectors return null; a malformed reserved envelope is always an error. */
export function decodeLocatorQuery(selector: string): QueryStep[] | null {
  if (!isSemanticSelector(selector)) return null;
  try {
    return wireSchema(SemanticLocatorQuerySchema).parse(
      JSON.parse(selector.slice(SEMANTIC_SELECTOR_PREFIX.length)),
    );
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid semantic locator query: ${detail}`, { cause });
  }
}
