import { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp";
import type { Frame } from "./frame";
import type { Locator } from "./locator";
import type { Page } from "./page";
import type {
  ScreenshotClip,
  ScreenshotScaleOption,
} from "../types/public/screenshotTypes";
import { StagehandInvalidArgumentError } from "../types/public/sdkErrors";

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
  const rectsByFrame = new Map<Frame, ScreenshotClip[]>();

  for (const locator of locators) {
    try {
      const info = await resolveMaskRect(locator);
      if (!info) continue;
      const list = rectsByFrame.get(info.frame) ?? [];
      list.push(info.rect);
      rectsByFrame.set(info.frame, list);
    } catch {
      // ignore individual locator failures
    }
  }

  if (rectsByFrame.size === 0) {
    return async () => {};
  }

  const token = `__v3_mask_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  await Promise.all(
    Array.from(rectsByFrame.entries()).map(([frame, rects]) =>
      frame
        .evaluate(
          ({ rects, color, token }) => {
            try {
              const doc = document;
              if (!doc) return;
              const root = doc.documentElement || doc.body;
              if (!root) return;
              for (const rect of rects) {
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
                root.appendChild(el);
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
      Array.from(rectsByFrame.keys()).map((frame) =>
        frame
          .evaluate((token) => {
            try {
              const doc = document;
              if (!doc) return;
              const nodes = doc.querySelectorAll(
                `[data-stagehand-mask="${token}"]`,
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

async function resolveMaskRect(
  locator: Locator,
): Promise<{ frame: Frame; rect: ScreenshotClip } | null> {
  const frame = locator.getFrame();
  const session = frame.session;
  let objectId: Protocol.Runtime.RemoteObjectId | null = null;

  try {
    const resolved = await locator.resolveNode();
    objectId = resolved.objectId;

    const result = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration: `function() {
          if (!this || typeof this.getBoundingClientRect !== 'function') return null;
          const rect = this.getBoundingClientRect();
          if (!rect) return null;
          const style = window.getComputedStyle(this);
          if (!style) return null;
          if (style.visibility === 'hidden' || style.display === 'none') return null;
          if (rect.width <= 0 || rect.height <= 0) return null;
          return {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
          };
        }`,
        returnByValue: true,
      },
    );

    if (result.exceptionDetails) {
      return null;
    }

    const rect = result.result.value as ScreenshotClip | null;
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

    return { frame, rect: { x, y, width, height } };
  } catch {
    return null;
  } finally {
    if (objectId) {
      await session
        .send<never>("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }
  }
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
