import { createHash } from "node:crypto";
import type { AgentEvidenceModality, Trajectory } from "./types.js";

type Image = Extract<AgentEvidenceModality, { type: "image" }>;

export function imageType(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  return undefined;
}

/** Recover typed MCP image data, including JSON-serialized Node Buffers. No URLs are fetched. */
function normalize(value: unknown, images: Image[]): unknown {
  if (
    typeof value === "string" &&
    (value.trimStart().startsWith("{") || value.trimStart().startsWith("[")) &&
    /"type"\s*:\s*"Buffer"|"mimeType"\s*:\s*"image\/|"screenshotBase64"\s*:/.test(value)
  ) {
    try {
      return JSON.stringify(normalize(JSON.parse(value), images));
    } catch {
      return value;
    }
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  let bytes: Buffer | undefined;
  if (Buffer.isBuffer(value)) bytes = value;
  else if (
    record.type === "Buffer" &&
    Array.isArray(record.data) &&
    record.data.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  )
    bytes = Buffer.from(record.data);
  else if (
    (record.type === "image" ||
      (typeof record.mimeType === "string" && record.mimeType.startsWith("image/"))) &&
    typeof record.data === "string" &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(record.data)
  ) {
    bytes = Buffer.from(record.data, "base64");
  }
  if (bytes) {
    const mediaType = imageType(bytes);
    if (mediaType) images.push({ type: "image", bytes, mediaType });
    return `[${mediaType ?? "binary"} artifact: ${bytes.length} bytes, sha256=${createHash("sha256").update(bytes).digest("hex")}]`;
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item, images));
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      key === "screenshotBase64" && typeof item === "string"
        ? normalize({ type: "image", data: item }, images)
        : normalize(item, images),
    ]),
  );
}

/** Copy the input: disk bytes and the caller's trajectory remain unchanged. */
export function normalizeEmbeddedArtifacts(trajectory: Trajectory): Trajectory {
  return {
    ...trajectory,
    steps: trajectory.steps.map((step) => {
      const images: Image[] = [];
      const modalities: AgentEvidenceModality[] = (
        step.agentEvidence?.modalities ?? []
      ).flatMap<AgentEvidenceModality>((modality) => {
        if (modality.type === "json")
          return [{ ...modality, content: normalize(modality.content, images) }];
        if (modality.type === "text")
          return [{ ...modality, content: String(normalize(modality.content, images)) }];
        if (Buffer.isBuffer(modality.bytes)) return [modality];
        normalize(modality.bytes, images);
        return [];
      });
      const result = normalize(step.toolOutput?.result, images);
      const existing = new Set(
        modalities
          .filter((m): m is Image => m.type === "image")
          .map((m) => createHash("sha256").update(m.bytes).digest("hex")),
      );
      for (const image of images) {
        const hash = createHash("sha256").update(image.bytes).digest("hex");
        if (!existing.has(hash)) {
          existing.add(hash);
          modalities.push(image);
        }
      }
      return { ...step, agentEvidence: { modalities }, toolOutput: { ...step.toolOutput, result } };
    }),
  };
}
