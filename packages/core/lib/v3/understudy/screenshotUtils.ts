import { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import type { Frame } from "./frame.js";
import type { Locator } from "./locator.js";
import type { Page } from "./page.js";
import type {
  ScreenshotClip,
  ScreenshotScaleOption,
} from "../types/public/screenshotTypes.js";
import { StagehandInvalidArgumentError } from "../types/public/sdkErrors.js";
import { screenshotScriptSources } from "../dom/build/screenshotScripts.generated.js";

export type ScreenshotCleanup = () => Promise<void> | void;

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
      throw new StagehandInvalidArgumentError(
        `screenshot: clip.${key} must be a finite number`,
      );
    }
  }

  if (width <= 0 || height <= 0) {
    throw new StagehandInvalidArgumentError(
      "screenshot: clip width/height must be positive",
    );
  }

  return { x, y, width, height };
}

export async function computeScreenshotScale(
  page: Page,
  mode: ScreenshotScaleOption,
): Promise<number | undefined> {
  if (mode !== "css") return undefined;
  try {
    const frame = page.mainFrame();
    const dpr = await frame
      .evaluate(() => {
        const ratio = Number(window.devicePixelRatio || 1);
        return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
      })
      .catch(() => 1);
    const safeRatio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    return Math.min(2, Math.max(0.1, 1 / safeRatio));
  } catch {
    return 1;
  }
}

export async function setTransparentBackground(
  session: CDPSessionLike,
): Promise<ScreenshotCleanup> {
  await session
    .send("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 },
    })
    .catch(() => {});

  return async () => {
    await session
      .send("Emulation.setDefaultBackgroundColorOverride", {})
      .catch(() => {});
  };
}

export async function applyStyleToFrames(
  frames: Frame[],
  css: string,
  label: string,
): Promise<ScreenshotCleanup> {
  const trimmed = css.trim();
  if (!trimmed) return async () => {};
  const token = `__v3_style_${label}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;

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
        )
        .catch(() => {}),
    ),
  );

  return async () => {
    await Promise.all(
      frames.map((frame) =>
        frame
          .evaluate((token) => {
            try {
              const doc = document;
              if (!doc) return;
              const nodes = doc.querySelectorAll(
                `[data-stagehand-style="${token}"]`,
              );
              nodes.forEach((node) => node.remove());
            } catch {
              // ignore
            }
          }, token)
          .catch(() => {}),
      ),
    );
  };
}

export async function disableAnimations(
  frames: Frame[],
): Promise<ScreenshotCleanup> {
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

  const cleanup = await applyStyleToFrames(frames, css, "animations");

  await Promise.all(
    frames.map((frame) =>
      frame
        .evaluate(() => {
          try {
            const animations =
              typeof document.getAnimations === "function"
                ? document.getAnimations()
                : [];
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
        })
        .catch(() => {}),
    ),
  );

  return cleanup;
}

export async function hideCaret(frames: Frame[]): Promise<ScreenshotCleanup> {
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

  return applyStyleToFrames(frames, css, "caret");
}

export async function applyMaskOverlays(
  locators: Locator[],
  color: string,
): Promise<ScreenshotCleanup> {
  type MaskRectSpec = ScreenshotClip & { rootToken?: string | null };
  const rectsByFrame = new Map<
    Frame,
    { rects: MaskRectSpec[]; rootTokens: Set<string> }
  >();

  const token = `__v3_mask_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  for (const locator of locators) {
    try {
      const info = await resolveMaskRects(locator, token);
      if (!info) continue;
      const entry = rectsByFrame.get(info.frame) ?? {
        rects: [],
        rootTokens: new Set<string>(),
      };
      entry.rects.push(...info.rects);
      for (const rect of info.rects) {
        if (rect.rootToken) entry.rootTokens.add(rect.rootToken);
      }
      rectsByFrame.set(info.frame, entry);
    } catch {
      // ignore individual locator failures
    }
  }

  if (rectsByFrame.size === 0) {
    return async () => {};
  }

  await Promise.all(
    Array.from(rectsByFrame.entries()).map(([frame, { rects }]) =>
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
                  ? doc.querySelector(
                      `[data-stagehand-mask-root="${rect.rootToken}"]`,
                    ) || defaultRoot
                  : defaultRoot;
                if (!root) continue;
                if (rect.rootToken) {
                  try {
                    const style = window.getComputedStyle(root as Element);
                    if (style && style.position === "static") {
                      const rootEl = root as HTMLElement;
                      if (
                        !rootEl.hasAttribute("data-stagehand-mask-root-pos")
                      ) {
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
                el.style.position = "absolute";
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
        )
        .catch(() => {}),
    ),
  );

  return async () => {
    await Promise.all(
      Array.from(rectsByFrame.entries()).map(([frame, { rootTokens }]) =>
        frame
          .evaluate(
            ({ token, rootTokens }) => {
              try {
                const doc = document;
                if (!doc) return;
                const nodes = doc.querySelectorAll(
                  `[data-stagehand-mask="${token}"]`,
                );
                nodes.forEach((node) => node.remove());
                for (const rootToken of rootTokens) {
                  const root = doc.querySelector(
                    `[data-stagehand-mask-root="${rootToken}"]`,
                  ) as HTMLElement | null;
                  if (!root) continue;
                  const prev = root.getAttribute(
                    "data-stagehand-mask-root-pos",
                  );
                  if (prev !== null) {
                    root.style.position = prev;
                    root.removeAttribute("data-stagehand-mask-root-pos");
                  }
                  root.removeAttribute("data-stagehand-mask-root");
                }
              } catch {
                // ignore
              }
            },
            { token, rootTokens: Array.from(rootTokens) },
          )
          .catch(() => {}),
      ),
    );
  };
}

async function resolveMaskRects(
  locator: Locator,
  maskToken: string,
): Promise<{
  frame: Frame;
  rects: Array<ScreenshotClip & { rootToken?: string | null }>;
} | null> {
  const frame = locator.getFrame();
  const session = frame.session;
  try {
    const resolved: Array<{
      objectId: Protocol.Runtime.RemoteObjectId;
      nodeId: Protocol.DOM.NodeId | null;
    }> = await locator.resolveNodesForMask();
    const rects: Array<ScreenshotClip & { rootToken?: string | null }> = [];

    for (const { objectId } of resolved) {
      try {
        const rect = await resolveMaskRectForObject(
          session,
          objectId,
          maskToken,
        );
        if (rect) rects.push(rect);
      } catch {
        // ignore individual element failures
      } finally {
        await session
          .send<never>("Runtime.releaseObject", { objectId })
          .catch(() => {});
      }
    }

    if (!rects.length) return null;

    return { frame, rects };
  } catch {
    return null;
  }
}

async function resolveMaskRectForObject(
  session: CDPSessionLike,
  objectId: Protocol.Runtime.RemoteObjectId,
  maskToken: string,
): Promise<(ScreenshotClip & { rootToken?: string | null }) | null> {
  const result = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
    "Runtime.callFunctionOn",
    {
      objectId,
      functionDeclaration: screenshotScriptSources.resolveMaskRect,
      arguments: [{ value: maskToken }],
      returnByValue: true,
    },
  );

  if (result.exceptionDetails) {
    return null;
  }

  const rect = result.result.value as
    | (ScreenshotClip & { rootToken?: string | null })
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
    rootToken:
      rect.rootToken && typeof rect.rootToken === "string"
        ? rect.rootToken
        : undefined,
  };
}

export async function runScreenshotCleanups(
  cleanups: ScreenshotCleanup[],
): Promise<void> {
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

export async function withScreenshotTimeout<T>(
  timeoutMs: number | undefined,
  task: () => Promise<T>,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return task();

  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`screenshot: timeout of ${timeoutMs}ms exceeded`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
