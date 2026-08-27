import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  aliasSuggestions,
  extractCommandTokens,
  suggestCommand,
} from "../src/lib/command-suggestions.js";

describe("extractCommandTokens", () => {
  it.each([
    [
      "lowercases colon-separated command tokens",
      "auth:status",
      ["auth", "status"],
    ],
    ["lowercases a single token", "Sessions", ["sessions"]],
    ["stops at URL-like tokens", "opne:https://example.com", ["opne", "https"]],
    ["drops a leading flag", "--badflag", []],
    ["stops at selector-like tokens", "fill:#password", ["fill"]],
    ["caps the number of tokens at four", "a:b:c:d:e:f", ["a", "b", "c", "d"]],
  ])("%s", (_label, input, expected) => {
    expect(extractCommandTokens(input)).toEqual(expected);
  });
});

describe("suggestCommand", () => {
  const commandIds = [
    "open",
    "doctor",
    "status",
    "cloud:search",
    "cloud:sessions:list",
    "cloud:sessions:create",
  ];

  // attempted/suggestion are colon-separated ids. The "attempted" field is what
  // gets surfaced in messaging + telemetry, so the trailing-token rows below
  // double as the privacy guard: a free-form user value must never be retained
  // unless it itself looks like a typo of a real command segment.
  it.each<[string, string, { attempted: string; suggestion: string | null }]>([
    [
      "prefers an explicit alias over a fuzzy match",
      "sessions",
      { attempted: "sessions", suggestion: "cloud:sessions:list" },
    ],
    [
      "strips trailing args before the alias lookup",
      "search:test",
      { attempted: "search", suggestion: "cloud:search" },
    ],
    [
      "matches the longest alias prefix first",
      "sessions:create",
      { attempted: "sessions:create", suggestion: "cloud:sessions:create" },
    ],
    [
      "falls back to the nearest command by edit distance",
      "opne",
      { attempted: "opne", suggestion: "open" },
    ],
    [
      "fuzzy-matches a misspelled deep command",
      "cloud:sesions:list",
      { attempted: "cloud:sesions:list", suggestion: "cloud:sessions:list" },
    ],
    [
      "omits a suggestion beyond the distance threshold",
      "frobnicate",
      { attempted: "frobnicate", suggestion: null },
    ],
    [
      "drops a trailing user token that does not align with a command segment",
      "stat:s",
      { attempted: "stat", suggestion: "status" },
    ],
    [
      "retains a trailing token that looks like a command-word typo",
      "cloud:sessions:lst",
      { attempted: "cloud:sessions:lst", suggestion: "cloud:sessions:list" },
    ],
    [
      "never retains an argument-like trailing token",
      "opne:https://example.com/?token=secret",
      { attempted: "opne", suggestion: "open" },
    ],
    [
      "returns no suggestion for an unknown command with an argument",
      "frobnicate:somevalue",
      { attempted: "frobnicate", suggestion: null },
    ],
    [
      "handles ids with no command-shaped tokens",
      "--badflag",
      { attempted: "", suggestion: null },
    ],
  ])("%s", (_label, input, expected) => {
    expect(suggestCommand(input, commandIds)).toEqual(expected);
  });

  it("does not map auth/login to unrelated commands", () => {
    expect(suggestCommand("auth:status", commandIds)?.suggestion).not.toBe(
      "doctor",
    );
    expect(suggestCommand("login", commandIds)?.suggestion).not.toBe("doctor");
  });
});

describe("alias table", () => {
  it("only maps to commands or topics that exist in the manifest", async () => {
    const manifestRaw = await readFile(
      new URL("../oclif.manifest.json", import.meta.url),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw) as {
      commands: Record<string, unknown>;
    };
    const ids = Object.keys(manifest.commands);

    for (const target of aliasSuggestions.values()) {
      const isCommand = ids.includes(target);
      const isTopic = ids.some((id) => id.startsWith(`${target}:`));
      expect(isCommand || isTopic, `alias target "${target}"`).toBe(true);
    }
  });
});
