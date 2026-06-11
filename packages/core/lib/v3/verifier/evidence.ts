/**
 * Evidence loader: hydrate tier-1 agent screenshots, tier-2 probe screenshots,
 * and the terminal final observation from a trajectory; dedup near-identical
 * frames with MSE + SSIM; and downsize for the relevance LLM call. The first
 * and last frames are always kept so the verifier can cite the trajectory's
 * bookends. `sharp` is loaded dynamically; if unavailable, dedup/resize no-op.
 */
import type {
  CanonicalEvidence,
  CanonicalScreenshot,
  CanonicalTextEvidence,
  EvidenceLoadOptions,
  EvidenceLoadResult,
  Trajectory,
} from "./types.js";

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
      // Dynamic specifier hides sharp from TypeScript's module resolver:
      // sharp is an optional runtime dep (evals/server installs it; core
      // consumers don't have to). try/catch handles missing-at-runtime.
      const specifier = "sharp";
      const mod = (await import(specifier)) as unknown as {
        default?: Sharp;
      } & Sharp;
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
  const ssimThreshold = opts.ssimThreshold ?? DEFAULT_SSIM_THRESHOLD;
  const mseThreshold = opts.mseThreshold ?? DEFAULT_MSE_THRESHOLD;
  const imageResize = opts.imageResize ?? DEFAULT_IMAGE_RESIZE;

  // Collect raw frames in chronological order. Per step we take tier-1
  // agent-mirrored screenshots first (the exact bytes a CUA provider saw, plus
  // any inline act() screenshots lifted into image modalities), then the
  // tier-2 post-action probe. Buffers are populated either live or after
  // loadTrajectoryFromDisk(); absent/empty buffers are skipped. Dedup collapses
  // near-identical frames downstream, so including both tiers is safe.
  const rawFrames: Array<{
    bytes: Buffer;
    originalStepIndex: number;
  }> = [];

  for (let i = 0; i < trajectory.steps.length; i++) {
    const step = trajectory.steps[i];
    // tier-1: agent screenshots, in modality order, before the probe.
    for (const m of step.agentEvidence?.modalities ?? []) {
      if (m.type === "image" && m.bytes && m.bytes.length > 0) {
        rawFrames.push({
          bytes: m.bytes,
          originalStepIndex: i,
        });
      }
    }
    // tier-2: post-action probe screenshot.
    const buf = step.probeEvidence?.screenshot;
    if (buf && buf.length > 0) {
      rawFrames.push({
        bytes: buf,
        originalStepIndex: i,
      });
    }
  }

  // Terminal page observation captured after the agent finished. Preserves the
  // legacy final-screenshot verification behavior; positioned after every step
  // so it anchors as the trajectory's closing frame (always kept as "last").
  const finalShot = trajectory.finalObservation?.screenshot;
  if (finalShot && finalShot.length > 0) {
    rawFrames.push({
      bytes: finalShot,
      originalStepIndex: trajectory.steps.length,
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
 * Images (tier-1 agent screenshots + tier-2 probes + the final observation)
 * go through {@link loadAndReduceScreenshots} (dedup + downscale).
 * Text evidence is sourced from:
 *   - tier-2 `probeEvidence.ariaTree` (and `finalObservation.ariaTree`)
 *   - tier-1 text/json modalities in `agentEvidence`
 *   - native `toolOutput.result`
 *
 * Text snippets are deduplicated on their full normalized content so a "stuck
 * on the same page" agent doesn't produce a flood of identical snippets.
 *
 * `canonicalIndex` is unified across both kinds: the first image gets 0,
 * the next image or text snippet gets 1, etc. The returned `loaded`
 * (`screenshots[].canonicalIndex` and `stepIndexToCanonical`) is re-stamped
 * into this same combined index space so every canonicalIndex in the result
 * references one array.
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
    stepIdx: number,
    source: CanonicalTextEvidence["source"],
    text: string | undefined,
  ) => {
    // Runtime guard, not just the type: trajectory JSON loaded from disk is
    // unvalidated, so a malformed non-string field must not crash collection.
    if (typeof text !== "string" || text.length === 0) return;
    const trimmed = text.length > 4000 ? text.slice(0, 4000) : text;
    const normalized = trimmed.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) return;
    // Dedupe on the full normalized text — a length+prefix key would collapse
    // distinct snippets that share a prefix. The 4k cap bounds key size.
    if (seenText.has(normalized)) return;
    seenText.add(normalized);
    pending.push({
      kind: "text",
      stepIdx,
      source,
      content: trimmed,
    });
  };

  for (let i = 0; i < trajectory.steps.length; i++) {
    const step = trajectory.steps[i];
    addTextEvidence(i, "probe-aria", step.probeEvidence?.ariaTree);

    for (const modality of step.agentEvidence?.modalities ?? []) {
      if (modality.type === "text") {
        addTextEvidence(i, "agent-text", modality.content);
      } else if (modality.type === "json") {
        addTextEvidence(
          i,
          "agent-json",
          safeStringifyEvidence(modality.content),
        );
      }
    }

    // Defensive: agentEvidence is derived from toolOutput today, but keeping
    // the native result as a fallback preserves evidence if that mapping
    // changes or an adapter omits modalities.
    addTextEvidence(
      i,
      "tool-output",
      safeStringifyEvidence(step.toolOutput?.result),
    );
  }

  // Terminal aria observation — mirrors the final screenshot frame so the
  // closing page state is scoreable even when the last step had no probe.
  addTextEvidence(
    trajectory.steps.length,
    "probe-aria",
    trajectory.finalObservation?.ariaTree,
  );

  // Sort by step position asc; ties → image before text so the
  // "page state before the harness probed text" reads naturally.
  pending.sort((a, b) => {
    const pa = a.kind === "image" ? a.shot.originalStepIndex : a.stepIdx;
    const pb = b.kind === "image" ? b.shot.originalStepIndex : b.stepIdx;
    if (pa !== pb) return pa - pb;
    return a.kind === "image" ? -1 : 1;
  });

  // Stamp canonical indices in the combined ordering. Track the screenshot
  // array-index → combined-index translation so the returned `loaded` can be
  // re-mapped onto the same space (previously screenshots[].canonicalIndex and
  // stepIndexToCanonical pointed into the images-only array and disagreed with
  // `evidence` once text was interleaved).
  const screenshotIdxToCombined = new Map<number, number>();
  for (const p of pending) {
    if (p.kind === "image") {
      const combinedIndex = evidence.length;
      screenshotIdxToCombined.set(p.shot.canonicalIndex, combinedIndex);
      evidence.push({ ...p.shot, canonicalIndex: combinedIndex });
    } else {
      evidence.push({
        canonicalIndex: evidence.length,
        originalStepIndex: p.stepIdx,
        source: p.source,
        content: p.content,
      });
    }
  }

  const remappedScreenshots = loaded.screenshots.map((shot) => {
    const combined = screenshotIdxToCombined.get(shot.canonicalIndex);
    return combined === undefined
      ? shot
      : { ...shot, canonicalIndex: combined };
  });
  const remappedStepIndex = new Map<number, number>();
  for (const [stepIdx, screenshotIdx] of loaded.stepIndexToCanonical) {
    const combined = screenshotIdxToCombined.get(screenshotIdx);
    if (combined !== undefined) remappedStepIndex.set(stepIdx, combined);
  }

  return {
    evidence,
    loaded: {
      ...loaded,
      screenshots: remappedScreenshots,
      stepIndexToCanonical: remappedStepIndex,
    },
  };
}

// ─── Internals ────────────────────────────────────────────────────────────

function safeStringifyEvidence(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  // Strings pass through verbatim — JSON.stringify would wrap them in quotes.
  if (typeof value === "string") return value;
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
