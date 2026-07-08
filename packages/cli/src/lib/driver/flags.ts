import { randomUUID } from "node:crypto";

import { Flags } from "@oclif/core";

import { fail } from "../errors.js";
import { listRunningSessions } from "./daemon/client.js";
import type { DriverStatus } from "./types.js";

export const sessionFlag = Flags.string({
  char: "s",
  description:
    "Named browser session to use. Defaults to BROWSE_SESSION, or auto-resolves against the currently running session(s).",
  helpValue: "<name>",
});

export const headedFlag = Flags.boolean({
  description: "Show a visible browser window for managed local sessions.",
});

export const headlessFlag = Flags.boolean({
  description: "Run managed local sessions in headless mode.",
});

export const localFlag = Flags.boolean({
  description: "Use a managed local browser session.",
});

export const remoteFlag = Flags.boolean({
  description: "Use a remote Browserbase browser session.",
});

export const verifiedFlag = Flags.boolean({
  description:
    "Open the remote session as a Verified (advanced-stealth) browser. Requires --remote and a Browserbase Scale plan.",
});

export const proxiesFlag = Flags.boolean({
  description:
    "Route the remote session through Browserbase proxies. Requires --remote.",
});

export const autoConnectFlag = Flags.boolean({
  description:
    "Auto-discover and attach to a local browser with remote debugging enabled.",
});

export const cdpFlag = Flags.string({
  description:
    "Attach directly to a CDP endpoint. Accepts a port, http(s) URL, or ws(s) URL.",
  helpValue: "<url|port>",
});

export const targetIdFlag = Flags.string({
  description:
    "Select a specific CDP target when attaching to an existing browser.",
  helpValue: "<target-id>",
});

export const chromeArgFlag = Flags.string({
  description:
    "Add a Chrome launch arg for managed local sessions. Repeatable.",
  helpValue: "<flag>",
  multiple: true,
});

export const ignoreDefaultChromeArgFlag = Flags.string({
  description:
    "Drop one of Chrome's default launch args for managed local sessions. Repeatable.",
  helpValue: "<flag>",
  multiple: true,
});

export const noDefaultChromeArgsFlag = Flags.boolean({
  description:
    "Launch managed local Chrome without any of its default launch args.",
});

export type SessionRole = "open" | "attach";

export interface ResolvedSession {
  /**
   * True when no explicit session was given and a fresh name was generated
   * (role "open"). Callers use this to decide whether to print the
   * human-readable "started new session" notice.
   */
  generated?: boolean;
  session: string;
  /**
   * Populated when role "attach" resolved via exactly one running session.
   * Callers should reuse this instead of issuing a second status round trip,
   * and pass it through to target resolution so `ensureDriverDaemon` attaches
   * to the already-running daemon instead of ever spawning one on this path.
   */
  status?: DriverStatus;
}

/**
 * Resolve the session name a driver command should use.
 *
 * Explicit resolution (`value`, i.e. `--session`/`-s`, or `BROWSE_SESSION`) is
 * unchanged from prior behavior: it always wins and is returned as-is with no
 * running-session lookup at all. This is what keeps explicit `--session
 * <name>` semantics identical on every command, including auto-starting a
 * daemon for a not-yet-running name.
 *
 * Without an explicit session, behavior depends on `role`:
 *  - "open": always mint a brand-new, unique session name. `browse open`
 *    never implicitly attaches to a running session — attaching implicitly
 *    would let a second agent silently clobber the first one's browser.
 *  - "attach": every other driver/session command resolves against the set
 *    of currently RUNNING sessions. Exactly one running session is used
 *    automatically; zero or multiple running sessions fail with an
 *    instructive message instead of guessing.
 */
export async function resolveSession(
  value: string | undefined,
  role: SessionRole,
): Promise<ResolvedSession> {
  const explicit = value ?? process.env.BROWSE_SESSION;
  if (explicit) return { session: explicit };

  if (role === "open") {
    return { generated: true, session: generateSessionName() };
  }

  const running = await listRunningSessions();
  if (running.length === 0) {
    fail("No running browser session. Start one with browse open <url>.", 1, {
      resultCode: "no_running_session",
    });
  }

  if (running.length > 1) {
    const candidates = running.map(
      ({ session, status }) => `  ${session} — ${status.url ?? "(no page)"}`,
    );
    fail(
      [
        "Multiple running sessions:",
        ...candidates,
        "Pass --session <name> to choose.",
      ].join("\n"),
      1,
      { resultCode: "ambiguous_session" },
    );
  }

  const [only] = running;
  return { session: only!.session, status: only!.status };
}

/**
 * Generate a fresh, unique session name for `browse open` when no explicit
 * session was requested. `sess-<8 hex chars>` already satisfies
 * `sanitizeSessionName`'s identity fast path (charset `[A-Za-z0-9._-]`, no
 * leading/trailing `.`/`-`), so it round-trips through daemon file paths
 * unchanged.
 */
export function generateSessionName(): string {
  return `sess-${randomUUID().split("-")[0]}`;
}
