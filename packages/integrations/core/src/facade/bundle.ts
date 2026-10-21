import { createHash } from "node:crypto";
import {
  ACTION_RUNNER_SOURCE,
  RUN_EPILOGUE,
  RUN_PRELUDE,
  RUNTIME_SOURCE,
} from "./batch-sources.js";
import {
  BROWSER_SESSION_LOST_ERROR,
  FACADE_BROWSER_CLOSED_ERROR,
  FACADE_LEGACY_TOOLS,
  FACADE_TOOLS,
  FACADE_TOOLS_EXPLICIT_SNAPSHOT,
  NAVIGATED_SNAPSHOT_ERROR,
  NO_HYDRATED_SNAPSHOT_ERROR,
  SCREENSHOT_ARTIFACT_PATH_ERROR,
  SCREENSHOT_ARTIFACT_SYMLINK_ERROR,
  SCREENSHOT_CAPTURED_MESSAGE,
  SCREENSHOT_COMPRESSED_MESSAGE,
  STALE_SNAPSHOT_ID_ERROR,
} from "./contract.js";

/** Bumped when the bundle's shape changes, not when its content does. */
export const FACADE_BUNDLE_VERSION = 1;

/**
 * Everything a non-TypeScript facade host needs to reproduce this facade, built
 * from the same constants the TS facade sends. The build writes it to
 * dist/facade-bundle.json.
 *
 * - sources: the `run` code callback is `runPrelude + code + runEpilogue`; the
 *   `run` actions callback is `actionRunner`, with `{ actions }` as input. Both
 *   are the exact callback source text for experimental_batch. `runtime` is the
 *   Playwright-compatible runtime the prelude embeds. Before sending run code,
 *   a host must check that `code` parses on its own as an async function body
 *   (what `AsyncFunction(params, code)` accepts) and otherwise fail the call
 *   with a SyntaxError, as the TS facade does; plain concatenation would let
 *   code that closes the function early run outside the callback.
 * - contract.tools: tools/list per tool set (`--surface=playwright`,
 *   `--surface=legacy`, and playwright with EXPLICIT_SNAPSHOT_ACTIONS=1).
 * - contract.errors: messages hosts must return verbatim; `${id}` and
 *   `${cause}` are placeholders.
 * - contract.messages: the screenshot tool's text, plain or after
 *   transport-safe compression.
 * - sha256: hex SHA-256 of the UTF-8 canonical JSON of `{ sources, contract }`
 *   (see canonicalJson).
 */
export function facadeBundle(packageVersion: string) {
  const content = {
    sources: {
      runtime: RUNTIME_SOURCE,
      runPrelude: RUN_PRELUDE,
      runEpilogue: RUN_EPILOGUE,
      actionRunner: ACTION_RUNNER_SOURCE,
    },
    contract: {
      tools: {
        playwright: FACADE_TOOLS,
        legacy: FACADE_LEGACY_TOOLS,
        explicitSnapshotActions: FACADE_TOOLS_EXPLICIT_SNAPSHOT,
      },
      errors: {
        NO_HYDRATED_SNAPSHOT_ERROR,
        NAVIGATED_SNAPSHOT_ERROR,
        STALE_SNAPSHOT_ID_ERROR,
        BROWSER_SESSION_LOST_ERROR,
        SCREENSHOT_ARTIFACT_PATH_ERROR,
        SCREENSHOT_ARTIFACT_SYMLINK_ERROR,
        FACADE_BROWSER_CLOSED_ERROR,
      },
      messages: {
        SCREENSHOT_CAPTURED_MESSAGE,
        SCREENSHOT_COMPRESSED_MESSAGE,
      },
    },
  };
  return {
    version: FACADE_BUNDLE_VERSION,
    packageVersion,
    sha256: createHash("sha256").update(canonicalJson(content)).digest("hex"),
    ...content,
  };
}

export type FacadeBundle = ReturnType<typeof facadeBundle>;

/**
 * JSON with object keys sorted at every level and no whitespace. Strings use
 * JSON.stringify escaping: non-ASCII characters stay unescaped (Python needs
 * `ensure_ascii=False`).
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
