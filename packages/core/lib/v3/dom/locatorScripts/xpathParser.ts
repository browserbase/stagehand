export interface XPathAttrPredicate {
  name: string;
  value: string;
}

export interface XPathStep {
  axis: "child" | "desc";
  tag: string;
  index: number | null;
  attrs: XPathAttrPredicate[];
}

/**
 * Parse an XPath expression into a list of traversal steps.
 *
 * This is a subset parser designed for composed DOM traversal (including
 * shadow roots). It intentionally does not implement the full XPath spec.
 *
 * Supported:
 *  - Child (`/`) and descendant (`//`) axes
 *  - Tag names and wildcard (`*`)
 *  - Positional indices (`[n]`)
 *  - Attribute equality predicates (`[@attr='value']`, `[@attr="value"]`)
 *  - Multiple predicates per step (`[@class='foo'][@id='bar']`)
 *  - Optional `xpath=` prefix
 *
 * Not supported:
 *  - Attribute existence without value (`[@attr]`)
 *  - String functions (`contains()`, `starts-with()`, `normalize-space()`)
 *  - Text matching (`[text()='value']`)
 *  - Boolean operators within predicates (`[@a='x' and @b='y']`)
 *  - Negation (`[not(...)]`)
 *  - Position functions (`[position() > n]`, `[last()]`)
 *  - Axes beyond child/descendant (`ancestor::`, `parent::`, `self::`,
 *    `preceding-sibling::`, `following-sibling::`)
 *  - Union operator (`|`)
 *  - Grouped expressions (`(//div)[n]`)
 *
 * Unsupported predicates are silently ignored — the step still matches
 * by tag name, but the unrecognized predicate has no filtering effect.
 */
export function parseXPathSteps(input: string): XPathStep[] {
  const path = String(input || "")
    .trim()
    .replace(/^xpath=/i, "");
  if (!path) return [];

  const steps: XPathStep[] = [];
  let i = 0;

  while (i < path.length) {
    let axis: "child" | "desc" = "child";
    if (path.startsWith("//", i)) {
      axis = "desc";
      i += 2;
    } else if (path[i] === "/") {
      axis = "child";
      i += 1;
    }

    const start = i;
    let bracketDepth = 0;
    while (i < path.length) {
      if (path[i] === "[") bracketDepth++;
      else if (path[i] === "]") bracketDepth--;
      else if (path[i] === "/" && bracketDepth === 0) break;
      i += 1;
    }
    const rawStep = path.slice(start, i).trim();
    if (!rawStep) continue;

    const { tag, index, attrs } = parseStep(rawStep);
    steps.push({ axis, tag, index, attrs });
  }

  return steps;
}

function parseStep(raw: string): {
  tag: string;
  index: number | null;
  attrs: XPathAttrPredicate[];
} {
  const bracketPos = raw.indexOf("[");
  if (bracketPos === -1) {
    const tag = raw === "" ? "*" : raw.toLowerCase();
    return { tag, index: null, attrs: [] };
  }

  const tagPart = raw.slice(0, bracketPos).trim();
  const tag = tagPart === "" ? "*" : tagPart.toLowerCase();
  const predicateStr = raw.slice(bracketPos);

  let index: number | null = null;
  const attrs: XPathAttrPredicate[] = [];

  const predicateRe = /\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = predicateRe.exec(predicateStr)) !== null) {
    const inner = m[1].trim();

    // Positional index: [n]
    if (/^\d+$/.test(inner)) {
      index = Math.max(1, Number(inner));
      continue;
    }

    // Attribute predicate: [@attr='value'] or [@attr="value"]
    const attrMatch = inner.match(
      /^@([a-zA-Z_][\w.-]*)\s*=\s*(?:'([^']*)'|"([^"]*)")$/,
    );
    if (attrMatch) {
      attrs.push({
        name: attrMatch[1],
        value: attrMatch[2] ?? attrMatch[3],
      });
    }
  }

  return { tag, index, attrs };
}

/**
 * Test whether an element matches the tag and attribute predicates of a step.
 * This is separated from the DOM traversal to keep the parser testable.
 */
export function elementMatchesStep(element: Element, step: XPathStep): boolean {
  if (step.tag !== "*" && element.localName !== step.tag) return false;
  for (const attr of step.attrs) {
    if (element.getAttribute(attr.name) !== attr.value) return false;
  }
  return true;
}
