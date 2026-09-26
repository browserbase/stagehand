/**
 * Split a selector on the `>>` iframe-hop separator.
 *
 * A `>>` inside a quoted value (`a[title="Next >>"]`, `//a[text()='>>']`) or
 * inside brackets/parentheses is part of the selector, not a hop.
 */
export function splitSelectorHops(selector: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  let start = 0;

  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "[" || ch === "(") depth += 1;
    else if ((ch === "]" || ch === ")") && depth > 0) depth -= 1;
    else if (depth === 0 && ch === ">" && selector[i + 1] === ">") {
      parts.push(selector.slice(start, i));
      i += 1;
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));

  return parts.map((part) => part.trim()).filter(Boolean);
}
