import type { Progress } from "./progress.js";
import { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import type { DeepLocatorDelegate } from "./deepLocator.js";
import type { Frame } from "./frame.js";
import type { Locator } from "./locator.js";
import type { Page } from "./page.js";
import type { ScreenshotClip, UnderstudyScreenshotOptions } from "../types/private/screenshot.js";
import { resolveMaskRect } from "../dom/screenshotScripts/index.js";

export type ScreenshotCleanup = () => Promise<void> | void;

const screenshotQueues = new WeakMap<object, { tail: Promise<void>; blocked: AbortController }>();

/** Serialize page mutations, or the browser-wide activation/capture critical section. */
export async function withScreenshotLock<T>(
  owner: object,
  capture: () => Promise<T>,
  progress: Progress,
): Promise<T> {
  progress.throwIfStopped();
  const queue = screenshotQueues.get(owner) ?? {
    tail: Promise.resolve(),
    blocked: new AbortController(),
  };
  // Keep late setup/cleanup isolated, but never make callers wait indefinitely for it.
  queue.blocked.signal.throwIfAborted();
  let started = false;
  const onAbort = () => {
    if (started) {
      const error = progress.signal.reason as Error;
      queue.blocked.abort(
        new Error(`A previous capture is still recovering: ${error.message}`, { cause: error }),
      );
    }
  };
  progress.signal.addEventListener("abort", onAbort, { once: true });
  const previous = queue.tail;
  const pending = waitForScreenshot(
    previous,
    AbortSignal.any([queue.blocked.signal, progress.signal]),
  ).then(async () => {
    queue.blocked.signal.throwIfAborted();
    progress.throwIfStopped();
    started = true;
    try {
      return await capture();
    } finally {
      started = false;
    }
  });
  const settled = pending.then(
    () => {},
    () => {},
  );
  // A queued request can fail before the active capture finishes. Retain both
  // promises so that failure cannot release the active capture's lock.
  const released = Promise.all([previous, settled]).then(() => {});
  queue.tail = released;
  screenshotQueues.set(owner, queue);
  try {
    // The page's operation bounds its caller; nested locks await actual recovery.
    return await pending;
  } finally {
    progress.signal.removeEventListener("abort", onAbort);
    void released.then(() => {
      if (queue.tail === released) screenshotQueues.delete(owner);
    });
  }
}

/** Bound a wait by an operation or queue recovery signal. */
async function waitForScreenshot<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await pending;
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function collectFramesForScreenshot(page: Page): Frame[] {
  const seen = new Map<string, Frame>();
  const main = page.mainFrame();
  seen.set(main.frameId, main);
  for (const frame of page.frames()) {
    seen.set(frame.frameId, frame);
  }
  return Array.from(seen.values());
}

export function normalizeScreenshotClip(clip: ScreenshotClip): ScreenshotClip {
  const x = Number(clip.x);
  const y = Number(clip.y);
  const width = Number(clip.width);
  const height = Number(clip.height);

  for (const [key, value] of Object.entries({ x, y, width, height })) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`screenshot: clip.${key} must be a finite number`);
    }
  }

  if (width <= 0 || height <= 0) {
    throw new RangeError("screenshot: clip width/height must be positive");
  }

  return { x, y, width, height };
}

export async function computeScreenshotScale(
  page: Page,
  mode: NonNullable<UnderstudyScreenshotOptions["scale"]>,
  progress: Progress,
): Promise<number | undefined> {
  if (mode !== "css") return undefined;
  const dpr = await page
    .mainFrame()
    .evaluate(
      () => {
        const ratio = Number(window.devicePixelRatio || 1);
        return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
      },
      undefined,
      progress,
    )
    .catch(() => {
      progress.throwIfStopped();
      return 1;
    });
  progress.throwIfStopped();
  const safeRatio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(2, Math.max(0.1, 1 / safeRatio));
}

export async function setTransparentBackground(
  session: CDPSessionLike,
  progress: Progress,
  cleanups: ScreenshotCleanup[],
): Promise<void> {
  progress.throwIfStopped();
  cleanups.push(async () => {
    await session.send("Emulation.setDefaultBackgroundColorOverride", {}).catch(() => {});
  });
  await session
    .send("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 },
    })
    .catch(() => {});
  progress.throwIfStopped();
}

export async function applyStyleToFrames(
  frames: Frame[],
  css: string,
  label: string,
  progress: Progress,
  cleanups: ScreenshotCleanup[],
): Promise<void> {
  const trimmed = css.trim();
  if (!trimmed) return;
  const token = `__v3_style_${label}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  cleanups.push(async () => {
    await Promise.all(
      frames.map((frame) =>
        frame
          .evaluate((token) => {
            try {
              const doc = document;
              if (!doc) return;
              const nodes = doc.querySelectorAll(`[data-stagehand-style="${token}"]`);
              nodes.forEach((node) => node.remove());
            } catch {
              // ignore
            }
          }, token)
          .catch(() => {}),
      ),
    );
  });

  // Await issued mutations so restoration cannot run before late setup finishes.
  await Promise.all(
    frames.map((frame) =>
      frame
        .evaluate(
          ({ css, token }) => {
            try {
              const doc = document;
              if (!doc) return;
              const style = doc.createElement("style");
              style.setAttribute("data-stagehand-style", token);
              style.textContent = css;
              const parent = doc.head || doc.documentElement || doc.body;
              parent?.appendChild(style);
            } catch {
              // ignore
            }
          },
          { css: trimmed, token },
          progress,
        )
        .catch(() => {}),
    ),
  );

  progress.throwIfStopped();
}

export async function disableAnimations(
  frames: Frame[],
  progress: Progress,
  cleanups: ScreenshotCleanup[],
): Promise<void> {
  const css = `
*,
*::before,
*::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  animation-iteration-count: 1 !important;
  animation-play-state: paused !important;
  transition-property: none !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
}`;

  await applyStyleToFrames(frames, css, "animations", progress, cleanups);

  await Promise.all(
    frames.map((frame) =>
      frame
        .evaluate(
          () => {
            try {
              const animations =
                typeof document.getAnimations === "function" ? document.getAnimations() : [];
              for (const animation of animations) {
                try {
                  const details = animation.effect?.getComputedTiming?.();
                  if (details && details.iterations !== Infinity) {
                    animation.finish?.();
                  } else {
                    animation.cancel?.();
                  }
                } catch {
                  animation.cancel?.();
                }
              }
            } catch {
              // ignore
            }
          },
          undefined,
          progress,
        )
        .catch(() => {}),
    ),
  );

  progress.throwIfStopped();
}

export async function hideCaret(
  frames: Frame[],
  progress: Progress,
  cleanups: ScreenshotCleanup[],
): Promise<void> {
  const css = `
input,
textarea,
[contenteditable],
[contenteditable=""],
[contenteditable="true"],
[contenteditable="plaintext-only"],
*:focus {
  caret-color: transparent !important;
}`;

  return applyStyleToFrames(frames, css, "caret", progress, cleanups);
}

export async function applyMaskOverlays(
  locators: Array<Locator | DeepLocatorDelegate>,
  color: string,
  progress: Progress,
  cleanups: ScreenshotCleanup[],
): Promise<void> {
  type MaskRectSpec = ScreenshotClip & {
    rootToken?: string | null;
    position?: "absolute" | "fixed";
  };
  const rectsByFrame = new Map<Frame, MaskRectSpec[]>();

  const token = `__v3_mask_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  cleanups.push(async () => {
    await Promise.all(
      Array.from(rectsByFrame.keys()).map((frame) =>
        frame
          .evaluate((token) => {
            try {
              const doc = document;
              if (!doc) return;
              const nodes = doc.querySelectorAll(`[data-stagehand-mask="${token}"]`);
              nodes.forEach((node) => node.remove());
              const roots = doc.querySelectorAll<HTMLElement>(
                `[data-stagehand-mask-root^="${token}"]`,
              );
              for (const root of roots) {
                const prev = root.getAttribute("data-stagehand-mask-root-pos");
                if (prev !== null) {
                  root.style.position = prev;
                  root.removeAttribute("data-stagehand-mask-root-pos");
                }
                root.removeAttribute("data-stagehand-mask-root");
              }
            } catch {
              // ignore
            }
          }, token)
          .catch(() => {}),
      ),
    );
  });

  for (const locator of locators) {
    try {
      progress.throwIfStopped();
      const resolved = "real" in locator ? await locator.real(progress) : locator;
      const frame = resolved.getFrame();
      const rects = rectsByFrame.get(frame) ?? [];
      rectsByFrame.set(frame, rects);
      rects.push(...(await resolveMaskRects(resolved, token, progress)));
    } catch {
      progress.throwIfStopped();
      // ignore individual locator failures
    }
  }

  if ([...rectsByFrame.values()].every((rects) => rects.length === 0)) return;

  await Promise.all(
    Array.from(rectsByFrame.entries()).map(([frame, rects]) =>
      frame
        .evaluate(
          ({ rects, color, token }) => {
            try {
              const doc = document;
              if (!doc) return;
              for (const rect of rects) {
                const defaultRoot = doc.documentElement || doc.body;
                if (!defaultRoot) return;
                const root = rect.rootToken
                  ? doc.querySelector(`[data-stagehand-mask-root="${rect.rootToken}"]`) ||
                    defaultRoot
                  : defaultRoot;
                if (!root) continue;
                if (rect.rootToken) {
                  try {
                    const style = window.getComputedStyle(root as Element);
                    if (style && style.position === "static") {
                      const rootEl = root as HTMLElement;
                      if (!rootEl.hasAttribute("data-stagehand-mask-root-pos")) {
                        rootEl.setAttribute(
                          "data-stagehand-mask-root-pos",
                          rootEl.style.position || "",
                        );
                      }
                      rootEl.style.position = "relative";
                    }
                  } catch {
                    // ignore
                  }
                }
                const el = doc.createElement("div");
                el.setAttribute("data-stagehand-mask", token);
                el.style.position = rect.position ?? "absolute";
                el.style.left = `${rect.x}px`;
                el.style.top = `${rect.y}px`;
                el.style.width = `${rect.width}px`;
                el.style.height = `${rect.height}px`;
                el.style.backgroundColor = color;
                el.style.pointerEvents = "none";
                el.style.zIndex = "2147483647";
                el.style.opacity = "1";
                el.style.mixBlendMode = "normal";
                (root as Element).appendChild(el);
              }
            } catch {
              // ignore
            }
          },
          { rects, color, token },
          progress,
        )
        .catch(() => {}),
    ),
  );

  // Wait outside the page's main world, where application code cannot replace the timer and
  // prevent masked screenshots from completing. This also gives Chromium a paint opportunity.
  await progress.delay(100);
}

async function resolveMaskRects(
  locator: Locator,
  maskToken: string,
  progress: Progress,
): Promise<Array<ScreenshotClip & { rootToken?: string | null }>> {
  const session = locator.getFrame().session;
  const resolved = await locator.resolveNodesForMask(progress);
  const rects: Array<ScreenshotClip & { rootToken?: string | null }> = [];
  try {
    for (const { objectId } of resolved) {
      progress.throwIfStopped();
      try {
        const rect = await resolveMaskRectForObject(session, objectId, maskToken);
        if (rect) rects.push(rect);
      } catch {
        progress.throwIfStopped();
        // ignore individual element failures
      }
    }
    return rects;
  } finally {
    // Release every resolved handle, including elements skipped after expiry.
    await Promise.all(
      resolved.map(({ objectId }) =>
        session.send("Runtime.releaseObject", { objectId }).catch(() => {}),
      ),
    );
  }
}

async function resolveMaskRectForObject(
  session: CDPSessionLike,
  objectId: Protocol.Runtime.RemoteObjectId,
  maskToken: string,
): Promise<
  (ScreenshotClip & { rootToken?: string | null; position?: "absolute" | "fixed" }) | null
> {
  const result = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
    "Runtime.callFunctionOn",
    {
      objectId,
      functionDeclaration: resolveMaskRect.toString(),
      arguments: [{ value: maskToken }],
      returnByValue: true,
    },
  );

  if (result.exceptionDetails) {
    return null;
  }

  const rect = result.result.value as
    | (ScreenshotClip & { rootToken?: string | null; position?: "absolute" | "fixed" })
    | null;
  if (!rect) return null;

  const { x, y, width, height } = rect;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    x,
    y,
    width,
    height,
    rootToken: rect.rootToken && typeof rect.rootToken === "string" ? rect.rootToken : undefined,
    position: rect.position === "fixed" ? "fixed" : "absolute",
  };
}

export async function runScreenshotCleanups(cleanups: ScreenshotCleanup[]): Promise<void> {
  for (let i = cleanups.length - 1; i >= 0; i -= 1) {
    const fn = cleanups[i];
    if (!fn) continue;
    try {
      const result = fn();
      if (result && typeof (result as Promise<void>).then === "function") {
        await result;
      }
    } catch {
      // ignore cleanup errors
    }
  }
}
