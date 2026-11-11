import type { Protocol } from "devtools-protocol";
import type { Page } from "./page.js";
import type { Progress } from "./progress.js";

export type WaitForURLOptions = {
  waitUntil?: "load" | "domcontentloaded";
  timeout?: number;
};

/** Full-URL glob: `*` stays within a path segment; `**` also matches slashes. */
export function urlMatcher(pattern: string): (url: string) => boolean {
  const source = pattern
    .split(/(\*\*|\*)/u)
    .map((part) => {
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      return part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    })
    .join("");
  const expression = new RegExp(`^${source}$`, "u");
  return (url) => expression.test(url);
}

/** One budget covers both matching the URL and reaching the requested load state. */
export async function waitForURL(
  page: Page,
  pattern: string,
  options: WaitForURLOptions,
  progress: Progress,
): Promise<void> {
  const matches = urlMatcher(pattern);
  while (true) {
    await waitForMatchingURL(page, matches, progress.signal);
    const frameId = page.mainFrameId();
    const loaderId = page.registry.frames.get(frameId)?.lastSeen?.loaderId;
    progress.throwIfStopped();
    await progress.run("waiting for load state", () =>
      page.waitForMainLoadState(options.waitUntil ?? "load", 0, progress.signal),
    );
    // Readiness must belong to the same document, even after a same-URL reload.
    if (
      matches(page.url()) &&
      page.mainFrameId() === frameId &&
      page.registry.frames.get(frameId)?.lastSeen?.loaderId === loaderId
    )
      return;
  }
}

function waitForMatchingURL(
  page: Page,
  matches: (url: string) => boolean,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const session = page.mainSession;
    const cleanup = () => {
      session.off("Page.frameNavigated", onNavigated);
      session.off("Page.navigatedWithinDocument", onSameDocument);
      signal.removeEventListener("abort", onAbort);
    };
    const check = (url: string) => {
      if (!matches(url)) return;
      cleanup();
      resolve();
    };
    const onNavigated = (event: Protocol.Page.FrameNavigatedEvent) => {
      if (!event.frame.parentId) check(event.frame.url + (event.frame.urlFragment ?? ""));
    };
    const onSameDocument = (event: Protocol.Page.NavigatedWithinDocumentEvent) => {
      if (event.frameId === page.mainFrameId()) check(event.url);
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    // Subscribe before checking the cached URL so no navigation can be missed.
    session.on("Page.frameNavigated", onNavigated);
    session.on("Page.navigatedWithinDocument", onSameDocument);
    signal.addEventListener("abort", onAbort, { once: true });
    check(page.url());
  });
}
