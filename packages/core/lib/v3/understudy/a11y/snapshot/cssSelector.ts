/**
 * Build CSS selectors from DOM node attributes.
 * Used during snapshot to provide alternative selectors alongside XPaths.
 */

/**
 * Parse the attributes array from Protocol.DOM.Node into a key-value map.
 * CDP returns attributes as [name1, value1, name2, value2, ...]
 */
export function parseAttributes(
  attributes: string[] | undefined,
): Record<string, string> {
  if (!attributes?.length) return {};
  const result: Record<string, string> = {};
  for (let i = 0; i < attributes.length; i += 2) {
    const name = attributes[i];
    const value = attributes[i + 1];
    if (name !== undefined && value !== undefined) {
      result[name] = value;
    }
  }
  return result;
}

/**
 * Escape a string for use in a CSS selector.
 * Handles special characters that need escaping.
 */
function cssEscape(str: string): string {
  return str.replace(/([^\w-])/g, "\\$1");
}

/**
 * Check if a class name is too generic to be useful for selection.
 * Filters out common utility classes from frameworks like Tailwind.
 */
function isGenericClass(className: string): boolean {
  // Filter utility classes that aren't useful for unique selection
  const genericPatterns = [
    /^(p|m|px|py|mx|my|pt|pb|pl|pr|mt|mb|ml|mr)-/, // padding/margin
    /^(w|h|min-w|min-h|max-w|max-h)-/, // width/height
    /^(flex|grid|block|inline|hidden)$/, // display
    /^(text|font|leading|tracking)-/, // typography
    /^(bg|border|rounded|shadow)-/, // visual
    /^(hover|focus|active|disabled):/, // state variants
    /^(sm|md|lg|xl|2xl):/, // responsive prefixes
    /^(dark|light):/, // theme variants
    /^\d+$/, // pure numbers
  ];
  return genericPatterns.some((pattern) => pattern.test(className));
}

/**
 * Build a CSS selector from DOM node attributes.
 * Returns undefined if no good selector can be built.
 *
 * Priority order:
 * 1. ID (most specific and stable)
 * 2. data-testid / data-test-id / data-cy (explicit testing targets)
 * 3. name attribute (for form elements)
 * 4. aria-label (accessibility-first)
 * 5. Specific classes (filtered for usefulness)
 */
export function buildCssSelector(
  attributes: string[] | undefined,
  tagName: string,
): string | undefined {
  const attrs = parseAttributes(attributes);
  const tag = tagName.toLowerCase();

  // Skip non-element tags
  if (tag === "#document" || tag === "#text" || tag === "#comment") {
    return undefined;
  }

  // Priority 1: ID (most reliable)
  if (attrs.id && !attrs.id.includes(" ")) {
    // Validate ID doesn't start with a number (invalid CSS)
    if (/^[a-zA-Z_-]/.test(attrs.id)) {
      return `#${cssEscape(attrs.id)}`;
    }
    // Use attribute selector for IDs starting with numbers
    return `[id="${attrs.id}"]`;
  }

  // Priority 2: data-testid / data-test-id / data-cy (testing targets)
  const testId =
    attrs["data-testid"] || attrs["data-test-id"] || attrs["data-cy"];
  if (testId) {
    const attrName = attrs["data-testid"]
      ? "data-testid"
      : attrs["data-test-id"]
        ? "data-test-id"
        : "data-cy";
    return `[${attrName}="${testId}"]`;
  }

  // Priority 3: name attribute (common for form elements)
  if (attrs.name && ["input", "select", "textarea", "button"].includes(tag)) {
    return `${tag}[name="${attrs.name}"]`;
  }

  // Priority 4: aria-label (accessibility selector)
  if (attrs["aria-label"]) {
    return `${tag}[aria-label="${attrs["aria-label"]}"]`;
  }

  // Priority 5: type + other attributes for inputs
  if (tag === "input" && attrs.type) {
    if (attrs.placeholder) {
      return `input[type="${attrs.type}"][placeholder="${attrs.placeholder}"]`;
    }
    // Common unique input types
    if (["submit", "reset", "file", "image"].includes(attrs.type)) {
      return `input[type="${attrs.type}"]`;
    }
  }

  // Priority 6: href for links (truncated for uniqueness)
  if (tag === "a" && attrs.href && !attrs.href.startsWith("javascript:")) {
    // Use partial href match for long URLs
    const href = attrs.href;
    if (href.length < 50) {
      return `a[href="${href}"]`;
    }
    // For long URLs, match the end
    const lastPart = href.split("/").pop();
    if (lastPart && lastPart.length > 3) {
      return `a[href$="${lastPart}"]`;
    }
  }

  // Priority 7: Specific classes (filtered)
  if (attrs.class) {
    const classes = attrs.class
      .split(/\s+/)
      .filter((c) => c && !isGenericClass(c));

    if (classes.length >= 1) {
      // Use up to 2 specific classes
      const useClasses = classes.slice(0, 2);
      return `${tag}.${useClasses.map(cssEscape).join(".")}`;
    }
  }

  // Priority 8: role attribute (semantic)
  if (attrs.role && !["presentation", "none"].includes(attrs.role)) {
    return `${tag}[role="${attrs.role}"]`;
  }

  // No good selector available - will fall back to XPath
  return undefined;
}
