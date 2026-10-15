export const IFRAME_STEP_RE = /^i?frame(?:\[\d+])?$/i;

/** Split an XPath at iframe steps, retaining the final in-frame path (or document root). */
export function splitXPathFrameHops(path: string): string[] {
  const parts: string[] = [];
  const source = path.trim();
  let current = "";
  let index = 0;
  while (index < source.length) {
    let axis = "/";
    if (source.startsWith("//", index)) {
      axis = "//";
      index += 2;
    } else if (source[index] === "/") {
      index += 1;
    }
    const start = index;
    while (index < source.length && source[index] !== "/") index += 1;
    const step = source.slice(start, index).trim();
    if (!step) continue;
    current += axis + step;
    if (IFRAME_STEP_RE.test(step.replace(/\[\d+\]\s*$/u, ""))) {
      parts.push(current);
      current = "";
    }
  }
  parts.push(current || "/");
  return parts;
}

/** Split legacy iframe/CSS hops without interpreting delimiters inside selector literals. */
export function splitSelectorHops(selector: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote: string | undefined;
  let brackets = 0;
  let parentheses = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets = Math.max(0, brackets - 1);
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses = Math.max(0, parentheses - 1);
    else if (!brackets && !parentheses && selector.startsWith(">>", index)) {
      parts.push(selector.slice(start, index).trim());
      start = index + 2;
      index += 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts.filter(Boolean);
}
