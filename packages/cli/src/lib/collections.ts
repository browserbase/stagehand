import { Flags } from "@oclif/core";
import { fail } from "./errors.js";
import { outputJson, resolveOutputFormat } from "./output.js";

/** Opt-in while existing scripts retain the version 1 output and limit semantics. */
export const collectionVersionFlag = {
  "list-version": Flags.string({
    options: ["1", "2"],
    default: "1",
    description:
      "List contract: 1 preserves existing behavior; 2 uses common limits and output.",
  }),
};

export const collectionLimitFlags = {
  limit: Flags.integer({
    min: 1,
    description: "Maximum records to return (list version 2 default: 20).",
  }),
  all: Flags.boolean({
    description: "Return every available record (list version 2).",
  }),
};

export interface CollectionFlags {
  "list-version"?: string;
  limit?: number;
  all?: boolean;
  cursor?: string;
  format?: string;
  json?: boolean;
  wide?: boolean;
}

export interface CollectionResult<T> {
  data: T[];
  /** null means the source does not expose whether its response is complete. */
  hasMore: boolean | null;
  /** A backend token, available only when it resumes after the last emitted row. */
  nextCursor: string | null;
}

export type CollectionSource<T> =
  | { kind: "array"; load: () => Promise<T[]>; complete: boolean }
  | {
      kind: "cursor";
      pageSize: number;
      loadPage: (options: { limit: number; cursor?: string }) => Promise<{
        data: T[];
        nextCursor: string | null;
      }>;
    };

export function usesCollectionContract(flags: CollectionFlags): boolean {
  return flags["list-version"] === "2";
}

export function validateCollectionFlags(flags: CollectionFlags): void {
  if (flags.all && flags.limit !== undefined)
    fail("--all and --limit cannot be used together with --list-version 2.");
  if (
    flags.limit !== undefined &&
    (!Number.isSafeInteger(flags.limit) || flags.limit < 1)
  )
    fail("--limit must be a positive safe integer.");
  if (flags.cursor !== undefined && !flags.cursor)
    fail("--cursor must be a non-empty continuation token.");
}

export async function collect<T>(
  source: CollectionSource<T>,
  flags: CollectionFlags,
): Promise<CollectionResult<T>> {
  validateCollectionFlags(flags);
  const limit = flags.all ? Infinity : (flags.limit ?? 20);
  if (source.kind === "array") {
    if (flags.cursor !== undefined)
      fail("This list source does not support --cursor.");
    const items = await source.load();
    return {
      data: items.slice(0, limit),
      hasMore: items.length > limit ? true : source.complete ? false : null,
      nextCursor: null,
    };
  }

  const data: T[] = [];
  let cursor = flags.cursor;
  const seen = new Set<string>(cursor === undefined ? [] : [cursor]);
  while (data.length < limit) {
    const requested = Math.min(source.pageSize, limit - data.length);
    const page = await source.loadPage({ limit: requested, cursor });
    // Silently slicing an oversized API page would skip records on continuation.
    if (page.data.length > requested)
      fail(
        "List API returned more records than requested; cannot safely continue.",
      );
    data.push(...page.data);
    if (page.nextCursor === null)
      return { data, hasMore: false, nextCursor: null };
    if (
      typeof page.nextCursor !== "string" ||
      !page.nextCursor ||
      seen.has(page.nextCursor)
    )
      fail("List API returned a repeated or empty pagination cursor.");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { data, hasMore: true, nextCursor: cursor ?? null };
}

export async function outputCollection<T>(options: {
  flags: CollectionFlags;
  source: CollectionSource<T>;
  table: (items: T[]) => void;
}): Promise<void> {
  // Collect before writing stdout so a later-page failure never looks like success.
  const result = await collect(options.source, options.flags);
  if (resolveOutputFormat(options.flags) === "json") {
    outputJson(result);
    return;
  }
  if (result.data.length === 0) console.log("No results.");
  else options.table(result.data);
  if (result.hasMore === true)
    console.log(
      `Showing ${result.data.length} results. More results are available; use --all or increase --limit.`,
    );
  else if (result.hasMore === null)
    console.log(
      `Showing ${result.data.length} results returned by the API; completeness is unknown.`,
    );
  if (result.nextCursor !== null)
    console.log(`Next cursor: ${result.nextCursor}`);
}

export function requireCollectionVersion(
  flags: CollectionFlags,
  names: Array<keyof CollectionFlags>,
): void {
  for (const name of names) {
    if (flags[name] !== undefined && flags[name] !== false)
      fail(`--${name} requires --list-version 2 for this command.`);
  }
}
