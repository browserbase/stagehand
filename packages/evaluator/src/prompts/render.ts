/**
 * Minimal Python-`string.Template`-compatible renderer for verifier prompts.
 *
 * The verifier prompt templates use Python's `string.Template` semantics:
 *   - `$identifier` is a substitution placeholder.
 *   - `$$` is a literal dollar sign.
 *
 * Porting strategy: keep the prompt strings verbatim (including `$$` for
 * literal dollars), and render them through this helper instead of switching
 * to TS template literals — the latter would require manually escaping every
 * `$` in the prose, which is error-prone for 2000+ lines of prompts.
 *
 * @example
 *   renderPrompt("Task: $task", { task: "Buy flour" }) === "Task: Buy flour"
 *   renderPrompt("Costs $$5", {}) === "Costs $5"
 */
export function renderPrompt(
  template: string,
  vars: Record<string, string | number | boolean | undefined>,
): string {
  // Single pass: `$$` and placeholders are matched together so interpolated
  // values are never rescanned.
  return template.replace(/\$\$|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, key?: string) => {
    if (key === undefined) return "$";
    if (Object.hasOwn(vars, key)) {
      const v = vars[key];
      return v === undefined ? "" : String(v);
    }
    // Unknown variable: leave it intact so a missing-binding bug surfaces.
    return match;
  });
}

/**
 * Build the optional "init URL context" sentence used by most prompts.
 * When the task carries a starting URL, append
 * "  Starting URL: <url>" after the task identifier; otherwise return empty.
 */
export function buildInitUrlContext(initUrl?: string): string {
  if (!initUrl) return "";
  return `\n    Starting URL: ${initUrl}`;
}
