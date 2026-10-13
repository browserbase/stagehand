import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import Browserbase from "@browserbasehq/sdk";
import { requireEnv } from "./session.ts";

const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string | null;

const POLL_MS = 5_000;
const TIMEOUT_MS = 10 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Browserbase assembles one MP4 per recorded page. Download the longest one and
// return when it started so timeline steps can be expressed as video offsets.
export async function downloadRecording(
  sessionId: string,
  outPath: string,
): Promise<{ startedAtMs: number | undefined }> {
  const bb = new Browserbase({ apiKey: requireEnv().BROWSERBASE_API_KEY });
  const deadline = Date.now() + TIMEOUT_MS;

  for (;;) {
    try {
      await bb.sessions.recording.downloads.create(sessionId);
      break;
    } catch (error) {
      // The session can take a few seconds to finalize after release.
      if (Date.now() > deadline) throw error;
      await sleep(POLL_MS);
    }
  }

  const replay = await bb.sessions.replays.retrieve(sessionId);
  const longest = [...replay.pages].sort(
    (a, b) => b.endTimeMs - b.startTimeMs - (a.endTimeMs - a.startTimeMs),
  )[0];
  if (!longest) throw new Error(`Session ${sessionId} recorded no pages`);

  for (;;) {
    const { downloads } = await bb.sessions.recording.downloads.list(sessionId);
    const page = downloads.find((download) => download.pageId === longest.pageId);
    if (page?.status === "FAILED") throw new Error(`MP4 assembly failed for ${sessionId}`);
    if (page?.status === "COMPLETED" && page.downloadUrl) {
      const response = await fetch(page.downloadUrl);
      if (!response.ok) throw new Error(`Recording download failed: ${response.status}`);
      await writeFile(outPath, new Uint8Array(await response.arrayBuffer()));
      // Replay timings are epoch milliseconds; anything smaller is relative.
      return { startedAtMs: longest.startTimeMs > 1e12 ? longest.startTimeMs : undefined };
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for MP4 of ${sessionId}`);
    await sleep(POLL_MS);
  }
}

// Browserbase recordings open on several seconds of black while the browser
// starts. Returns where the first real frame appears, in seconds.
export async function leadingBlackSeconds(video: string): Promise<number> {
  if (!ffmpeg) throw new Error("ffmpeg-static has no binary for this platform");
  const { stderr } = await promisify(execFile)(ffmpeg, [
    "-i",
    video,
    "-vf",
    "blackdetect=d=0.2:pix_th=0.10",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const first = /black_start:([\d.]+) black_end:([\d.]+)/.exec(stderr);
  return first && Number(first[1]) < 0.1 ? Number(first[2]) : 0;
}

// Browserbase MP4s run ~2 MB per 10 s. Screen recordings survive a low frame
// rate and a high CRF well, which gets a 100 s run near 1 MB for the website.
// Cuts the startup black; returns how many seconds were cut.
export async function compressRecording(input: string, output: string): Promise<number> {
  if (!ffmpeg) throw new Error("ffmpeg-static has no binary for this platform");
  const trimmed = await leadingBlackSeconds(input);
  await promisify(execFile)(ffmpeg, [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    String(trimmed),
    "-i",
    input,
    "-an",
    "-vf",
    "fps=12,scale=1280:-2",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output,
  ]);
  await rm(input);
  return trimmed;
}

// The last frame shows where the run ended, which makes the most useful poster.
export async function extractPoster(video: string, output: string): Promise<void> {
  if (!ffmpeg) throw new Error("ffmpeg-static has no binary for this platform");
  await promisify(execFile)(ffmpeg, [
    "-y",
    "-loglevel",
    "error",
    "-sseof",
    "-1",
    "-i",
    video,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    output,
  ]);
}
