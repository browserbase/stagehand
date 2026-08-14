/*
 * Runs inside the page context, same constraints as the other locator scripts:
 * dependency-free and tolerant of exceptions.
 */

/** `<input>` types that carry their label in `value` instead of in a child text node. */
const LABELLED_INPUT_TYPES = new Set(["button", "reset", "submit"]);

/**
 * The text a text selector should match an element on, when that text is not in the DOM.
 *
 * Returns `null` for elements that hold their text as child nodes, so callers keep reading
 * `innerText`/`textContent` for those. An `<input>` never has child nodes, so it always
 * answers here: its label for `button`, `reset` and `submit`, and the empty string for the
 * types whose value is user data rather than a label.
 */
export function attributeLabelText(element: Element): string | null {
  try {
    if ((element.tagName ?? "").toUpperCase() !== "INPUT") return null;
    const input = element as HTMLInputElement;
    // The `type` property normalizes case and unknown values, so `type="SUBMIT"` lands here
    // and `type="totally-made-up"` reads as `text`, exactly as the browser treats them.
    const type = String(input.type ?? "").toLowerCase();
    if (!LABELLED_INPUT_TYPES.has(type)) return "";
    return String(input.value ?? "").trim();
  } catch {
    return null;
  }
}
