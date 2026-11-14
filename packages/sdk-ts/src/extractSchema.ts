import { z } from "zod/v4";

// JSON Schema marker the extension resolves to an element selector. Keep in sync with
// EXTRACT_SCHEMA_MARKER_KEYWORD / EXTRACT_ELEMENT_MARKER in packages/extension/utils.ts.
const EXTRACT_ELEMENT_SCHEMA_MARKER = { "x-stagehand": "element" } as const;

/**
 * Schema helper for `stagehand.extract()` that resolves to the element a value came from.
 *
 * The field is a string. After extraction it holds an `xpath=` selector for the source element, in
 * the same format as `observe()` selectors, so it can be passed to `page.locator()`. If
 * the model's answer can't be resolved to an element on the page, the field is an empty string.
 *
 * @example
 * ```ts
 * const { data } = await stagehand.extract(
 *   "every account number in the list",
 *   z.object({
 *     accounts: z.array(z.object({ number: z.string(), element: elementRef() })),
 *   }),
 * );
 * const match = data.accounts.find((account) => normalize(account.number) === target);
 * if (match) await page.locator(match.element).click();
 * ```
 *
 * @param description Optional guidance for the model about which element to reference.
 */
export function elementRef(description?: string): z.ZodString {
  const schema = z.string().meta(EXTRACT_ELEMENT_SCHEMA_MARKER);
  return description === undefined ? schema : schema.describe(description);
}
