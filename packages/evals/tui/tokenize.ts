/**
 * Shared tokenizer for the evals TUI.
 *
 * Splits a line into tokens on whitespace OR `>` (the context-traversal
 * separator). Inside single- or double-quoted strings, every character
 * including `>` is preserved literally — so quoted args like
 * `"foo>bar"` survive intact.
 *
 * Used by both the REPL (tui/repl.ts) and argv mode (cli.ts) so that
 * `evals experiments > list` behaves identically to `evals experiments list`
 * from the shell, and inside the REPL `experiments > list` is identical
 * to `experiments list`.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t" || ch === ">") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}
