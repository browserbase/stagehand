/**
 * Suggestion engine for unknown commands.
 *
 * oclif's spaced-topic parsing glues unknown leading argv tokens into the
 * attempted command id (e.g. `browse opne https://example.com` arrives as
 * `opne:https://example.com`), so the id may contain user-provided values.
 * Everything here works on a sanitized token prefix and never returns raw
 * argv content beyond the tokens that matched a known command shape.
 */

/**
 * Old Commander-era syntax (and common agent guesses) mapped to the current
 * command tree. Keys and values are colon-separated oclif ids; values may
 * also be topics (e.g. `cloud:contexts`, which prints topic help).
 */
export const aliasSuggestions: ReadonlyMap<string, string> = new Map([
  ["auth", "doctor"],
  ["auth:status", "doctor"],
  ["login", "doctor"],
  ["sessions", "cloud:sessions:list"],
  ["sessions:list", "cloud:sessions:list"],
  ["sessions:create", "cloud:sessions:create"],
  ["sessions:get", "cloud:sessions:get"],
  ["projects", "cloud:projects:list"],
  ["projects:list", "cloud:projects:list"],
  ["contexts", "cloud:contexts"],
  ["extensions", "cloud:extensions"],
  ["search", "cloud:search"],
  ["fetch", "cloud:fetch"],
  ["goto", "open"],
  ["navigate", "open"],
]);

const safeTokenPattern = /^[A-Za-z][A-Za-z0-9_-]*$/;
const maxCommandTokens = 4;
const maxSuggestionDistance = 5;

export interface CommandSuggestion {
  /** Sanitized colon-separated tokens treated as the attempted command. */
  attempted: string;
  /** Colon-separated suggested command or topic, when a decent match exists. */
  suggestion: string | null;
}

/**
 * Extracts the leading command-shaped tokens from an attempted id, stopping
 * at the first token that does not look like a command word (URLs, selectors,
 * flags, and other argument-like values).
 */
export function extractCommandTokens(id: string): string[] {
  const tokens: string[] = [];
  for (const token of id.split(":")) {
    if (tokens.length >= maxCommandTokens || !safeTokenPattern.test(token)) {
      break;
    }
    tokens.push(token.toLowerCase());
  }
  return tokens;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0 || b.length === 0) {
    return a.length || b.length;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      const substitution =
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(deletion, insertion, substitution);
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length] ?? 0;
}

function tokenThreshold(token: string): number {
  return Math.max(2, Math.floor(token.length / 3));
}

/**
 * Segment-aligned fuzzy distance between a token prefix and a command id.
 * Only command ids with the same number of segments are considered, and every
 * token must be within its own edit-distance threshold of the corresponding
 * segment. This means a trailing token can only ever be retained in the
 * attempted command when it itself looks like a typo of a real command
 * segment — free-form user values can never ride along.
 */
function prefixDistance(
  tokens: readonly string[],
  commandId: string,
): number | null {
  const segments = commandId.split(":");
  if (segments.length !== tokens.length) {
    return null;
  }

  let total = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const distance = levenshtein(token, segments[i] ?? "");
    if (distance > tokenThreshold(token)) {
      return null;
    }
    total += distance;
  }

  return total > maxSuggestionDistance ? null : total;
}

/**
 * Computes a suggestion for an unknown command id. Explicit aliases win over
 * fuzzy matches, and longer token prefixes win over shorter ones so that
 * `auth status` resolves before `auth`. Returns only the matched prefix as
 * `attempted` (or the first token when nothing matches) so user-provided
 * values never escape into messaging or telemetry.
 */
export function suggestCommand(
  id: string,
  commandIds: readonly string[],
): CommandSuggestion {
  const tokens = extractCommandTokens(id);
  if (tokens.length === 0) {
    return { attempted: "", suggestion: null };
  }

  for (let length = tokens.length; length >= 1; length--) {
    const attempted = tokens.slice(0, length).join(":");
    const alias = aliasSuggestions.get(attempted);
    if (alias) {
      return { attempted, suggestion: alias };
    }
  }

  let best: (CommandSuggestion & { distance: number }) | undefined;
  for (let length = tokens.length; length >= 1; length--) {
    const prefix = tokens.slice(0, length);
    for (const commandId of commandIds) {
      const distance = prefixDistance(prefix, commandId);
      if (distance !== null && (!best || distance < best.distance)) {
        best = { attempted: prefix.join(":"), suggestion: commandId, distance };
      }
    }
  }

  if (best) {
    return { attempted: best.attempted, suggestion: best.suggestion };
  }

  return { attempted: tokens[0] ?? "", suggestion: null };
}
