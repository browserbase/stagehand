/**
 * Suggestion engine for unknown commands.
 *
 * oclif's spaced-topic parsing glues unknown leading argv tokens into the
 * attempted command id (e.g. `browse opne https://example.com` arrives as
 * `opne:https://example.com`), so the id may contain user-provided values.
 * Everything here works on a sanitized token prefix and never returns raw
 * argv content beyond the tokens that matched a known command shape.
 */

import { distance } from "fastest-levenshtein";

export const aliasSuggestions: ReadonlyMap<string, string> = new Map([
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
  attempted: string;
  suggestion: string | null;
}

export function extractCommandTokens(id: string): string[] {
  const tokens: string[] = [];
  for (const token of id.split(":", maxCommandTokens + 1)) {
    if (tokens.length >= maxCommandTokens || !safeTokenPattern.test(token)) {
      break;
    }
    tokens.push(token.toLowerCase());
  }
  return tokens;
}

function tokenThreshold(token: string): number {
  return Math.max(2, Math.floor(token.length / 3));
}

function prefixDistance(tokens: readonly string[], commandId: string): number | null {
  const segments = commandId.split(":");
  if (segments.length !== tokens.length) {
    return null;
  }

  let total = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const segment = segments[i] ?? "";
    const maxForSegment = Math.min(tokenThreshold(token), maxSuggestionDistance - total);
    if (Math.abs(token.length - segment.length) > maxForSegment) {
      return null;
    }
    const segmentDistance = distance(token, segment);
    if (segmentDistance > maxForSegment) {
      return null;
    }
    total += segmentDistance;
  }

  return total > maxSuggestionDistance ? null : total;
}

export function suggestCommand(id: string, commandIds: readonly string[]): CommandSuggestion {
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
      const prefixDist = prefixDistance(prefix, commandId);
      if (prefixDist !== null && (!best || prefixDist < best.distance)) {
        best = {
          attempted: prefix.join(":"),
          suggestion: commandId,
          distance: prefixDist,
        };
      }
    }
  }

  if (best) {
    return { attempted: best.attempted, suggestion: best.suggestion };
  }

  return { attempted: tokens[0] ?? "", suggestion: null };
}
