/**
 * Evidence — Step 1 of the rubric verifier pipeline.
 *
 * Loads probe screenshots from a Trajectory (file path or in-memory Buffer),
 * deduplicates near-identical frames using a quick MSE + SSIM dissimilarity
 * check (mirrors `packages/evals/utils/ScreenshotCollector`), and downsizes
 * each kept frame by `VERIFIER_IMAGE_RESIZE` (default 0.7) so the
 * Step 2 relevance scoring LLM call sees smaller images.
 *
 * Always-keep policy: the first and last screenshots are kept regardless of
 * similarity, so the verifier can always cite the trajectory's bookends.
 *
 * Environment knobs:
 *   - VERIFIER_SSIM_THRESHOLD (default 0.75) — frames with SSIM >= threshold
 *     are considered duplicates and dropped.
 *   - VERIFIER_MSE_THRESHOLD  (default 30)   — frames with MSE < threshold
 *     short-circuit to "duplicate" without running SSIM.
 *   - VERIFIER_IMAGE_RESIZE   (default 0.7)  — scale factor applied before
 *     relevance scoring.
 *
 * Architectural notes:
 *   - This module never touches a live browser. It reads screenshots from
 *     `Trajectory.steps[i].probeEvidence.{screenshot,screenshotPath}` only.
 *   - `sharp` is loaded via dynamic import so core stays portable for
 *     consumers that don't install image deps; if sharp is unavailable, the
 *     dedup/resize steps no-op and every screenshot is kept at its native
 *     size. The verifier still runs end-to-end, just with more tokens spent
 *     on near-duplicate frames.
 *   - `originalStepIndex → canonicalScreenshotIndex` mapping is exposed so
 *     downstream prompts can keep citing the trajectory step (e.g.,
 *     "Screenshot N — step=K, action=..."), preserving the rubric's link
 *     between visual evidence and the action history.
 */
import type { Trajectory } from "./trajectory.js";

// Lazy-loaded `sharp` namespace. When `sharp` is not installed, we fall back
// to keep-everything-at-native-size. Keep this structural so core does not
// need to publish sharp as a runtime dependency.
interface SharpImage {
  metadata(): Promise<{ width?: number; height?: number }>;
  resize(
    width: number,
    height?: number,
    options?: { fit?: string; kernel?: unknown },
  ): SharpImage;
  resize(options: { width: number; height: number }): SharpImage;
  raw(): SharpImage;
  grayscale(): SharpImage;
  png(options?: {
    compressionLevel?: number;
    adaptiveFiltering?: boolean;
    palette?: boolean;
  }): SharpImage;
  toBuffer(): Promise<Buffer>;
}

type Sharp = ((input: Buffer) => SharpImage) & {
  kernel: { lanczos3: unknown };
};
let sharpPromise: Promise<Sharp | null> | null = null;

async function loadSharp(): Promise<Sharp | null> {
  if (sharpPromise) return sharpPromise;
  sharpPromise = (async (): Promise<Sharp | null> => {
    try {
      const mod = (await import("sharp")) as unknown as {
        default?: Sharp;
      } & Sharp;
      // Some bundlers wrap ESM CJS deps differently — handle both.
      return (mod.default ?? mod) as Sharp;
    } catch {
      return null;
    }
  })();
  return sharpPromise;
}

const DEFAULT_SSIM_THRESHOLD = 0.75;
const DEFAULT_MSE_THRESHOLD = 30;
const DEFAULT_IMAGE_RESIZE = 0.7;

/** A single screenshot kept by Step 1, ready for downstream relevance scoring. */
export interface CanonicalScreenshot {
  /** 0-based position in the kept-screenshots array. Stable across the pipeline. */
  canonicalIndex: number;
  /**
   * Trajectory step index this screenshot came from. Matches
   * `Trajectory.steps[i].index`. Lets downstream prompts cross-reference the
   * action history.
   */
  originalStepIndex: number;
  /** Position of the step in `Trajectory.steps` (0..steps.length-1). */
  trajectoryStepPosition: number;
  /** The resized PNG/JPEG buffer (or native bytes if sharp unavailable). */
  bytes: Buffer;
  /** MIME media type. Always "image/png" after the (optional) resize. */
  mediaType: string;
  /** Reason this frame was kept: "first" / "last" / "diverges". */
  keptReason: "first" | "last" | "diverges" | "no-dedup";
}

/**
 * A text evidence point sourced from tier-2 probes or tier-1 tool outputs.
 * These feed the same relevance + scoring path as screenshots, letting DOM
 * and hybrid agents preserve extract/aria/tool-return evidence without a
 * separate verifier architecture.
 */
export interface CanonicalTextEvidence {
  /** 0-based position in the combined evidence-point array. */
  canonicalIndex: number;
  originalStepIndex: number;
  trajectoryStepPosition: number;
  /** Where the text came from. */
  source: "probe-aria" | "agent-text" | "agent-json" | "tool-output";
  /** The text payload, already truncated. */
  content: string;
}

export type CanonicalEvidence = CanonicalScreenshot | CanonicalTextEvidence;

/** Discriminator helpers — kind === "image" for screenshots. */
export function isImageEvidence(
  e: CanonicalEvidence,
): e is CanonicalScreenshot {
  return "bytes" in e && (e as CanonicalScreenshot).bytes instanceof Buffer;
}

export function isTextEvidence(
  e: CanonicalEvidence,
): e is CanonicalTextEvidence {
  return (
    "content" in e && typeof (e as CanonicalTextEvidence).content === "string"
  );
}

/** Result of Step 1. */
export interface EvidenceLoadResult {
  /** Kept frames, in chronological order. */
  screenshots: CanonicalScreenshot[];
  /**
   * Maps `Trajectory.steps[i].index` → canonical index in `screenshots`. Step
   * indices that were deduplicated point to the surviving canonical frame
   * (typically the prior kept frame). Useful for "find me the screenshot for
   * step K" lookups in downstream prompts.
   */
  stepIndexToCanonical: Map<number, number>;
  /** Number of original frames considered. */
  originalCount: number;
  /** Number of frames kept post-dedup (== screenshots.length). */
  keptCount: number;
  /** Effective thresholds used (resolved from env). */
  thresholds: {
    ssim: number;
    mse: number;
    resize: number;
  };
}

/** Options for {@link loadAndReduceScreenshots}. Mainly env override hooks for tests. */
export interface EvidenceLoadOptions {
  /** Override VERIFIER_SSIM_THRESHOLD. */
  ssimThreshold?: number;
  /** Override VERIFIER_MSE_THRESHOLD. */
  mseThreshold?: number;
  /** Override VERIFIER_IMAGE_RESIZE. */
  imageResize?: number;
}

/**
 * Step 1 — load trajectory screenshots from disk (or memory), deduplicate,
 * and downsize.
 *
 * Returns an array of canonical screenshots ready to feed into Step 2.
 * Steps without a captured probe screenshot are skipped silently — they
 * never reach the canonical array, but their action context still appears
 * in the prompt's action history.
 */
export async function loadAndReduceScreenshots(
  trajectory: Trajectory,
  opts: EvidenceLoadOptions = {},
): Promise<EvidenceLoadResult> {
  const ssimThreshold =
    opts.ssimThreshold ??
    readPositiveFloatEnv("VERIFIER_SSIM_THRESHOLD", DEFAULT_SSIM_THRESHOLD);
  const mseThreshold =
    opts.mseThreshold ??
    readPositiveFloatEnv("VERIFIER_MSE_THRESHOLD", DEFAULT_MSE_THRESHOLD);
  const imageResize =
    opts.imageResize ??
    readPositiveFloatEnv("VERIFIER_IMAGE_RESIZE", DEFAULT_IMAGE_RESIZE);

  // Collect raw frames in chronological order. probeEvidence.screenshot is
  // populated either live (Buffer) or after loadTrajectoryFromDisk(). When
  // both are absent we skip — there's no image to score.
  const rawFrames: Array<{
    bytes: Buffer;
    originalStepIndex: number;
    trajectoryStepPosition: number;
  }> = [];

  for (let i = 0; i < trajectory.steps.length; i++) {
    const step = trajectory.steps[i];
    const buf = step.probeEvidence?.screenshot;
    if (!buf || buf.length === 0) continue;
    rawFrames.push({
      bytes: buf,
      originalStepIndex: step.index,
      trajectoryStepPosition: i,
    });
  }

  const sharp = await loadSharp();
  const stepIndexToCanonical = new Map<number, number>();

  if (rawFrames.length === 0) {
    return {
      screenshots: [],
      stepIndexToCanonical,
      originalCount: 0,
      keptCount: 0,
      thresholds: {
        ssim: ssimThreshold,
        mse: mseThreshold,
        resize: imageResize,
      },
    };
  }

  // ── Dedup ──────────────────────────────────────────────────────────────
  // First + last always kept. Middle frames kept iff they're sufficiently
  // dissimilar to the previously kept frame. Dissimilarity check mirrors
  // ScreenshotCollector: quick MSE pass, escalate to SSIM only if MSE
  // suggests the frames differ. If sharp is unavailable, keep everything.
  const keptRaw: Array<{
    bytes: Buffer;
    originalStepIndex: number;
    trajectoryStepPosition: number;
    keptReason: CanonicalScreenshot["keptReason"];
  }> = [];

  // Track which raw-frame index each step maps to. Pre-fill with "the last
  // kept frame so far" so dropped frames fall back to their surviving peer.
  const rawIdxByStep = new Map<number, number>();

  let lastKeptIdx = 0;

  for (let i = 0; i < rawFrames.length; i++) {
    const frame = rawFrames[i];
    const isFirst = i === 0;
    const isLast = i === rawFrames.length - 1;

    let keep = true;
    let reason: CanonicalScreenshot["keptReason"] = sharp
      ? "diverges"
      : "no-dedup";

    if (sharp && !isFirst && !isLast) {
      const prev = keptRaw[keptRaw.length - 1];
      try {
        const mse = await calculateMSE(sharp, prev.bytes, frame.bytes);
        if (mse < mseThreshold) {
          keep = false;
        } else {
          const ssim = await calculateSSIM(sharp, prev.bytes, frame.bytes);
          // Drop when "too similar" (SSIM at or above threshold). Mirrors
          // ScreenshotCollector.shouldKeep = ssim < threshold.
          if (ssim >= ssimThreshold) keep = false;
        }
      } catch {
        // Comparison error → keep the frame (safer to err on inclusion).
        keep = true;
      }
    } else if (isFirst) {
      reason = "first";
    } else if (isLast) {
      reason = "last";
    }

    if (keep) {
      keptRaw.push({
        bytes: frame.bytes,
        originalStepIndex: frame.originalStepIndex,
        trajectoryStepPosition: frame.trajectoryStepPosition,
        keptReason: reason,
      });
      lastKeptIdx = keptRaw.length - 1;
    }
    rawIdxByStep.set(frame.originalStepIndex, lastKeptIdx);
  }

  // ── Resize ─────────────────────────────────────────────────────────────
  const screenshots: CanonicalScreenshot[] = await Promise.all(
    keptRaw.map(async (raw, canonicalIndex): Promise<CanonicalScreenshot> => {
      const resized = sharp
        ? await resizePng(sharp, raw.bytes, imageResize)
        : raw.bytes;
      return {
        canonicalIndex,
        originalStepIndex: raw.originalStepIndex,
        trajectoryStepPosition: raw.trajectoryStepPosition,
        bytes: resized,
        mediaType: "image/png",
        keptReason: raw.keptReason,
      };
    }),
  );

  // Build step → canonical index lookup from the dropped-fallback table.
  for (const [stepIdx, rawIdx] of rawIdxByStep.entries()) {
    stepIndexToCanonical.set(stepIdx, rawIdx);
  }

  return {
    screenshots,
    stepIndexToCanonical,
    originalCount: rawFrames.length,
    keptCount: screenshots.length,
    thresholds: {
      ssim: ssimThreshold,
      mse: mseThreshold,
      resize: imageResize,
    },
  };
}

/**
 * Collect a combined evidence-point list (images + ariaTree text snippets).
 *
 * Images go through {@link loadAndReduceScreenshots} (dedup + downscale).
 * Text evidence is sourced from:
 *   - tier-2 `probeEvidence.ariaTree`
 *   - tier-1 text/json modalities in `agentEvidence`
 *   - native `toolOutput.result`
 *
 * Text snippets are deduplicated by content hash so a "stuck on the same
 * page" agent doesn't produce a flood of identical snippets.
 *
 * `canonicalIndex` is unified across both kinds: the first image gets 0,
 * the next image or text snippet gets 1, etc. Downstream Step-2 relevance
 * scoring sees all evidence points in one numbering scheme.
 */
export async function collectCanonicalEvidence(
  trajectory: Trajectory,
  opts: EvidenceLoadOptions = {},
): Promise<{
  evidence: CanonicalEvidence[];
  loaded: EvidenceLoadResult;
}> {
  const loaded = await loadAndReduceScreenshots(trajectory, opts);
  const evidence: CanonicalEvidence[] = [];

  // Interleave images and text by step position so the resulting array is
  // (roughly) chronological. We collect texts per step, then merge by
  // step position with images.
  type Pending =
    | { kind: "image"; shot: CanonicalScreenshot }
    | {
        kind: "text";
        stepPos: number;
        stepIdx: number;
        source: CanonicalTextEvidence["source"];
        content: string;
      };
  const pending: Pending[] = [];

  for (const shot of loaded.screenshots) {
    pending.push({ kind: "image", shot });
  }

  const seenText = new Set<string>();
  const addTextEvidence = (
    stepPos: number,
    stepIdx: number,
    source: CanonicalTextEvidence["source"],
    raw: unknown,
  ) => {
    const text = typeof raw === "string" ? raw : safeStringifyEvidence(raw);
    if (!text || text.length === 0) return;
    const trimmed = text.length > 4000 ? text.slice(0, 4000) : text;
    const normalized = trimmed.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) return;
    const dedupKey = `${normalized.length}:${normalized.slice(0, 200)}`;
    if (seenText.has(dedupKey)) return;
    seenText.add(dedupKey);
    pending.push({
      kind: "text",
      stepPos,
      stepIdx,
      source,
      content: trimmed,
    });
  };

  for (let i = 0; i < trajectory.steps.length; i++) {
    const step = trajectory.steps[i];
    addTextEvidence(i, step.index, "probe-aria", step.probeEvidence?.ariaTree);

    for (const modality of step.agentEvidence?.modalities ?? []) {
      if (modality.type === "text") {
        addTextEvidence(i, step.index, "agent-text", modality.content);
      } else if (modality.type === "json") {
        addTextEvidence(i, step.index, "agent-json", modality.content);
      }
    }

    // Defensive: agentEvidence is derived from toolOutput today, but keeping
    // the native result as a fallback preserves evidence if that mapping
    // changes or an adapter omits modalities.
    addTextEvidence(i, step.index, "tool-output", step.toolOutput?.result);
  }

  // Sort by trajectoryStepPosition asc; ties → image before text so the
  // "page state before the harness probed text" reads naturally.
  pending.sort((a, b) => {
    const pa = a.kind === "image" ? a.shot.trajectoryStepPosition : a.stepPos;
    const pb = b.kind === "image" ? b.shot.trajectoryStepPosition : b.stepPos;
    if (pa !== pb) return pa - pb;
    return a.kind === "image" ? -1 : 1;
  });

  for (const p of pending) {
    if (p.kind === "image") {
      // Re-stamp canonical index in the combined ordering.
      const shot: CanonicalScreenshot = {
        ...p.shot,
        canonicalIndex: evidence.length,
      };
      evidence.push(shot);
    } else {
      evidence.push({
        canonicalIndex: evidence.length,
        originalStepIndex: p.stepIdx,
        trajectoryStepPosition: p.stepPos,
        source: p.source,
        content: p.content,
      });
    }
  }

  return { evidence, loaded };
}

// ─── Internals ────────────────────────────────────────────────────────────

function safeStringifyEvidence(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Port of `imageResize` from packages/evals/utils. Re-encodes as PNG with
 * palette + max compression so the downstream LLM call sees smaller bytes.
 * No-op when sharp can't read the buffer dimensions.
 */
async function resizePng(
  sharp: Sharp,
  bytes: Buffer,
  scaleFactor: number,
): Promise<Buffer> {
  if (scaleFactor >= 0.999 && scaleFactor <= 1.001) return bytes;
  try {
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) return bytes;
    const width = Math.max(1, Math.round(metadata.width * scaleFactor));
    const height = Math.max(1, Math.round(metadata.height * scaleFactor));
    return await sharp(bytes)
      .resize(width, height, {
        fit: "inside",
        kernel: sharp.kernel.lanczos3,
      })
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true,
        palette: true,
      })
      .toBuffer();
  } catch {
    return bytes;
  }
}

/**
 * Port of `ScreenshotCollector.calculateMSE`. Resamples both images to a
 * fixed small size and computes the per-byte squared error mean. Lower
 * means more similar.
 */
async function calculateMSE(
  sharp: Sharp,
  img1: Buffer,
  img2: Buffer,
): Promise<number> {
  const size = { width: 400, height: 300 };
  const data1 = await sharp(img1).resize(size).raw().toBuffer();
  const data2 = await sharp(img2).resize(size).raw().toBuffer();
  if (data1.length !== data2.length) return Number.MAX_SAFE_INTEGER;
  let sum = 0;
  for (let i = 0; i < data1.length; i++) {
    const diff = data1[i] - data2[i];
    sum += diff * diff;
  }
  return sum / data1.length;
}

/**
 * Port of `ScreenshotCollector.calculateSSIM`. Simplified single-window
 * SSIM on grayscale at 400×300. Returns a value in [0, 1] where 1 ==
 * identical (after grayscale downsample).
 */
async function calculateSSIM(
  sharp: Sharp,
  img1: Buffer,
  img2: Buffer,
): Promise<number> {
  const size = { width: 400, height: 300 };
  const gray1 = await sharp(img1).resize(size).grayscale().raw().toBuffer();
  const gray2 = await sharp(img2).resize(size).grayscale().raw().toBuffer();
  if (gray1.length !== gray2.length) return 0;

  const c1 = 0.01 * 0.01;
  const c2 = 0.03 * 0.03;
  let sum1 = 0;
  let sum2 = 0;
  let sum1Sq = 0;
  let sum2Sq = 0;
  let sum12 = 0;
  const N = gray1.length;
  for (let i = 0; i < N; i++) {
    sum1 += gray1[i];
    sum2 += gray2[i];
    sum1Sq += gray1[i] * gray1[i];
    sum2Sq += gray2[i] * gray2[i];
    sum12 += gray1[i] * gray2[i];
  }
  const mean1 = sum1 / N;
  const mean2 = sum2 / N;
  const var1 = sum1Sq / N - mean1 * mean1;
  const var2 = sum2Sq / N - mean2 * mean2;
  const cov12 = sum12 / N - mean1 * mean2;
  const numerator = (2 * mean1 * mean2 + c1) * (2 * cov12 + c2);
  const denominator = (mean1 * mean1 + mean2 * mean2 + c1) * (var1 + var2 + c2);
  return numerator / denominator;
}

function readPositiveFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
