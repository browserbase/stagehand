import type { HybridSnapshot } from "../../types/private/snapshot.js";
import type { JsonSchema } from "./extractionSchema.js";
import { headingLevel, isNativeElementPath } from "./nativeHeading.js";
import { parseOutline } from "./outline.js";

const request =
  /^(?:list|extract|return|copy) (?:all|every) (?:h([1-6])|level[ -]([1-6]|one|two|three|four|five|six)) (section )?headings?(?: on this page)?(?: in (?:document )?order)?\.?(?: Return the result in ([a-zA-Z][a-zA-Z0-9_]*?)\.)?$/iu;

export type HeadingRequest = { level: number; field: string; sections: boolean };

export function requestedHeadings(
  instruction: string,
  schema: JsonSchema,
): HeadingRequest | undefined {
  const match = request.exec(instruction.trim());
  if (!match) return;
  const field = match[4] ?? "headings";
  const list = schema.properties?.[field];
  if (
    schema.type !== "object" ||
    Object.keys(schema.properties ?? {}).length !== 1 ||
    schema.required?.length !== 1 ||
    schema.required[0] !== field ||
    Object.keys(schema).some(
      (k) => !["$schema", "type", "properties", "required", "additionalProperties"].includes(k),
    ) ||
    list?.type !== "array" ||
    Object.keys(list).some((k) => k !== "type" && k !== "items") ||
    list.items?.type !== "string" ||
    Object.keys(list.items).length !== 1
  )
    return;
  const token = (match[1] ?? match[2])!.toLowerCase();
  const level = Number(token) || ["one", "two", "three", "four", "five", "six"].indexOf(token) + 1;
  return { level, field, sections: Boolean(match[3]) };
}

// Executed in the page. Enumerating the document independently catches omissions in the outline.
export function readHeadingText({
  level,
  sections,
}: Pick<HeadingRequest, "level" | "sections">): string[] | undefined {
  if (
    document.contentType !== "text/html" ||
    document.readyState === "loading" ||
    document.querySelector(
      'iframe,frame,object,embed,[role~="heading" i],:is(h1,h2,h3,h4,h5,h6):is([aria-level],[role])',
    )
  )
    return;
  const headings = document.querySelectorAll<HTMLElement>(`h${level}`);
  if (!headings.length || headings.length > 128) return;
  const values: string[] = [];
  for (const node of headings) {
    if (
      (sections &&
        node.closest(
          'nav,aside,header,footer,dialog,[role~="navigation" i],[role~="complementary" i],[role~="banner" i],[role~="contentinfo" i],[role~="dialog" i]',
        )) ||
      !node.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      }) ||
      !node.getClientRects().length ||
      node.closest('[hidden],[inert],[aria-hidden="true" i]')
    )
      return;
    let value = node.innerText.trim();
    if (value.includes("\n") && !node.querySelector("br")) {
      // Flatten layout breaks from block-level decorations in a heading's label.
      // A preformatted descendant can contain an authored newline.
      const parts = [node, ...node.querySelectorAll("*")];
      if (parts.every((part) => ["normal", "nowrap"].includes(getComputedStyle(part).whiteSpace)))
        value = value.replace(/\n+/gu, " ");
    }
    if (!value || value.length > 512) return;
    values.push(value);
  }
  return values;
}

export function snapshotHeadingNames(
  snapshot: HybridSnapshot,
  level: number,
): string[] | undefined {
  if (snapshot.perFrame?.length !== 1) return;
  const paths = Object.values(snapshot.combinedXpathMap);
  if (paths.some((path) => path.includes("//") || /\/(?:iframe|frame|object|embed)\[/.test(path)))
    return;
  const count = paths.filter((path) => headingLevel(path) === level).length;
  if (!count || count > 128) return;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const node of parseOutline(snapshot.combinedTree)) {
    if (node.role !== "heading") continue;
    const path = snapshot.combinedXpathMap[node.id];
    if (!isNativeElementPath(path) || !headingLevel(path)) return;
    if (headingLevel(path) === level) {
      if (seen.has(path)) return;
      seen.add(path);
      names.push(node.name.replace(/\s+/gu, " ").trim());
    }
  }
  if (names.length === count) return names;
}
