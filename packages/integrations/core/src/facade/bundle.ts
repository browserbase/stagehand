import { createHash } from "node:crypto";
import {
  ACTION_RUNNER_SOURCE,
  RUN_EPILOGUE,
  RUN_PRELUDE,
  RUNTIME_SOURCE,
} from "./batch-sources.js";
import {
  BROWSER_SESSION_LOST_ERROR,
  DEFAULT_ARTIFACT_DIRECTORY,
  FACADE_AGENT_INSTRUCTIONS,
  FACADE_BROWSER_CLOSED_ERROR,
  FACADE_LEGACY_TOOLS,
  FACADE_TOOLS,
  FACADE_TOOLS_EXPLICIT_SNAPSHOT,
  facadeAgentInstructions,
  LEGACY_FACADE_AGENT_INSTRUCTIONS,
  NAVIGATED_SNAPSHOT_ERROR,
  NO_HYDRATED_SNAPSHOT_ERROR,
  RUN_OPTIONS,
  RUN_RESULT_LIMITS,
  RUN_RESULT_MALFORMED_ERROR,
  RUN_VALUE_SIZE_ERROR,
  SCREENSHOT_ARTIFACT_CONTENT_ERROR,
  SCREENSHOT_ARTIFACT_COUNT_ERROR,
  SCREENSHOT_ARTIFACT_FILE_SYMLINK_ERROR,
  SCREENSHOT_ARTIFACT_NOT_DIRECTORY_ERROR,
  SCREENSHOT_ARTIFACT_NOT_FILE_ERROR,
  SCREENSHOT_ARTIFACT_PATH_ERROR,
  SCREENSHOT_ARTIFACT_SIZE_ERROR,
  SCREENSHOT_ARTIFACT_SYMLINK_ERROR,
  SCREENSHOT_ARTIFACT_TOTAL_SIZE_ERROR,
  SCREENSHOT_ARTIFACT_TYPE_ERROR,
  SCREENSHOT_ARTIFACT_WRITE_ERROR,
  SCREENSHOT_CAPTURED_MESSAGE,
  SCREENSHOT_COMPRESSED_MESSAGE,
  STALE_SNAPSHOT_ID_ERROR,
  UNMANAGED_ACTIVE_PAGE_ERROR_MARKER,
} from "./contract.js";

/** Bumped when the bundle's shape changes, not when its content does. */
export const FACADE_BUNDLE_VERSION = 7;

/**
 * Everything a non-TypeScript facade host needs to reproduce this facade, built
 * from the same constants the TS facade sends. The build writes it to
 * dist/facade-bundle.json.
 *
 * - sources: exact callback source text for experimental_batch; a host only
 *   supplies the batch input. `runtime` is the Playwright-compatible runtime
 *   the prelude embeds.
 *   - `run` code: `runPrelude + code + runEpilogue`, input
 *     `{ hiddenPageIds?: string[], quietWait?: boolean }`: pages agent code
 *     must not see, such as a keeper tab, and the options in
 *     `contract.runOptions`, sent only when turned on. It resolves to
 *     `{ __stagehandPlaywrightCompat: true, value, executionError?: { name,
 *     message, stack? }, telemetry, artifacts: { path, base64 }[],
 *     closeRequested, batchRuntimeMs }`; an error thrown by `code` arrives as
 *     executionError, not as a batch failure. Before sending,
 *     a host must make sure `code` cannot close the callback early and
 *     otherwise fail the call with a SyntaxError; plain concatenation would let
 *     such code run outside the callback. The TS facade parses the whole
 *     callback body, strict mode included, with `AsyncFunction`. A host without
 *     a JavaScript engine may instead check that `code` parses on its own as an
 *     async function body; conformance cases marked notApplicable record where
 *     the two checks differ.
 *     The host fails the call with RUN_RESULT_MALFORMED_ERROR, without closing
 *     or writing anything, unless the result has the marker, `closeRequested`
 *     boolean, `batchRuntimeMs` number, `telemetry` object, `artifacts` array
 *     of `{ path, base64 }` with base64 padded RFC 4648, and `executionError`
 *     absent, null or `{ name, message, stack? }` strings. It then checks
 *     `contract.limits` (artifact count, then per artifact its decoded size
 *     and the running total), then checks every artifact before creating the
 *     artifact root or writing anything: its path stays within the root
 *     (default `contract.defaultArtifactDirectory` under the working
 *     directory) and no path component contains NUL, or ':' on Windows; its
 *     name ends in .png, .jpg or .jpeg in any case; its bytes start with a PNG
 *     or JPEG signature; no component is over 255 bytes. It then writes the
 *     artifacts in order, checking each one in turn on the filesystem: the
 *     default root is not a symlink, every directory on the way is a
 *     directory and not a symlink, and an existing file is a regular file and
 *     not a symlink. Each artifact is
 *     written to a new file in the target's directory and renamed over the
 *     target, so an existing file is replaced (keeping its permissions) rather
 *     than written through. Filesystem errors become
 *     SCREENSHOT_ARTIFACT_WRITE_ERROR with the error code as `${cause}`.
 *     It then raises executionError, and finally checks the value's
 *     compact-JSON size; whatever fails, it closes the session afterwards
 *     when `closeRequested` is true. packages/integrations/core/conformance holds
 *     cases every host must pass.
 *   - `run` actions: `actionRunner`, input `{ actions, xpathById }` with the
 *     validated actions and the XPath map of the active page's latest snapshot.
 *     It resolves to `{ completed }`, or to `{ staleId }` without running any
 *     action when an ID has no XPath; the host then fails with
 *     STALE_SNAPSHOT_ID_ERROR. The host still checks for a missing snapshot and
 *     for navigation since the snapshot before sending.
 * - contract.tools: tools/list per tool set (`--surface=playwright`,
 *   `--surface=legacy`, and playwright with EXPLICIT_SNAPSHOT_ACTIONS=1).
 * - contract.instructions: the agent instructions for each of those tool
 *   sets. The MCP server sends none; a host puts them in the agent's system
 *   prompt, as the evals harness does with facadeAgentInstructions() and
 *   LEGACY_FACADE_AGENT_INSTRUCTIONS.
 * - contract.errors: messages hosts must return verbatim; `${id}` and
 *   `${cause}` are placeholders.
 * - contract.limits: caps on a run result (RUN_RESULT_LIMITS), in bytes.
 * - contract.defaultArtifactDirectory: where artifacts go, under the working
 *   directory, when the host sets no artifact root.
 * - contract.sdkErrorMarkers: substrings of SDK errors hosts recognise, e.g.
 *   UNMANAGED_ACTIVE_PAGE_ERROR_MARKER (see the hosts' active-page lookup).
 * - contract.runOptions: the `run` input options, with their defaults and the
 *   constants the runtime uses for them (RUN_OPTIONS).
 * - contract.messages: the screenshot tool's text, plain or after
 *   transport-safe compression.
 * - sha256: hex SHA-256 of the UTF-8 canonical JSON of `{ sources, contract }`
 *   (see canonicalJson).
 */
export function facadeBundle(packageVersion: string) {
  // A frozen copy: callers can't change the sources, caps or wording that the
  // module's own hosts keep using.
  const content = deepFreeze(
    structuredClone({
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
        instructions: {
          playwright: FACADE_AGENT_INSTRUCTIONS,
          legacy: LEGACY_FACADE_AGENT_INSTRUCTIONS,
          explicitSnapshotActions: facadeAgentInstructions({ EXPLICIT_SNAPSHOT_ACTIONS: "1" }),
        },
        errors: {
          NO_HYDRATED_SNAPSHOT_ERROR,
          NAVIGATED_SNAPSHOT_ERROR,
          STALE_SNAPSHOT_ID_ERROR,
          BROWSER_SESSION_LOST_ERROR,
          SCREENSHOT_ARTIFACT_PATH_ERROR,
          SCREENSHOT_ARTIFACT_SYMLINK_ERROR,
          SCREENSHOT_ARTIFACT_FILE_SYMLINK_ERROR,
          SCREENSHOT_ARTIFACT_NOT_FILE_ERROR,
          SCREENSHOT_ARTIFACT_NOT_DIRECTORY_ERROR,
          SCREENSHOT_ARTIFACT_TYPE_ERROR,
          SCREENSHOT_ARTIFACT_CONTENT_ERROR,
          SCREENSHOT_ARTIFACT_WRITE_ERROR,
          FACADE_BROWSER_CLOSED_ERROR,
          RUN_RESULT_MALFORMED_ERROR,
          SCREENSHOT_ARTIFACT_COUNT_ERROR,
          SCREENSHOT_ARTIFACT_SIZE_ERROR,
          SCREENSHOT_ARTIFACT_TOTAL_SIZE_ERROR,
          RUN_VALUE_SIZE_ERROR,
        },
        limits: RUN_RESULT_LIMITS,
        defaultArtifactDirectory: DEFAULT_ARTIFACT_DIRECTORY,
        sdkErrorMarkers: { UNMANAGED_ACTIVE_PAGE_ERROR_MARKER },
        runOptions: RUN_OPTIONS,
        messages: {
          SCREENSHOT_CAPTURED_MESSAGE,
          SCREENSHOT_COMPRESSED_MESSAGE,
        },
      },
    }),
  );
  return Object.freeze({
    version: FACADE_BUNDLE_VERSION,
    packageVersion,
    sha256: createHash("sha256").update(canonicalJson(content)).digest("hex"),
    ...content,
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
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
