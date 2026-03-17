import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";
import { ViewImageOrDocumentArgsSchema } from "../protocol.js";
import type { ToolSpec } from "./types.js";

const MAX_TEXT_BYTES = 64 * 1024;
const BINARY_SAMPLE_BYTES = 4 * 1024;

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".ico",
  ".tif",
  ".tiff",
  ".avif",
]);

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".csv",
  ".tsv",
  ".html",
  ".htm",
  ".xml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".less",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".sh",
  ".bash",
  ".fish",
  ".zsh",
  ".sql",
  ".log",
]);

export const FUNCTIONS_VIEW_IMAGE_OR_DOCUMENT_RESULT_SCHEMA = z.object({
  ok: z.boolean(),
  path: z.string(),
  exists: z.boolean(),
  kind: z.enum(["text", "image", "pdf", "binary", "directory", "missing"]),
  media_type: z.string().nullable(),
  size_bytes: z.number().nullable(),
  text: z.string().nullable(),
  truncated: z.boolean(),
  ocr: z.object({
    requested: z.boolean(),
    attempted: z.boolean(),
    supported: z.boolean(),
    message: z.string().nullable(),
  }),
  error: z.string().optional(),
});

export const functions_view_image_or_document = {
  name: "functions_view_image_or_document",
  description:
    "Inspect a local workspace path and return metadata plus text content for text-like files.",
  inputSchema: ViewImageOrDocumentArgsSchema,
  outputSchema: FUNCTIONS_VIEW_IMAGE_OR_DOCUMENT_RESULT_SCHEMA,
  execute: async (input, context) =>
    FUNCTIONS_VIEW_IMAGE_OR_DOCUMENT_RESULT_SCHEMA.parse(
      await inspectArtifact(input.path, input.ocr ?? false, context.workspace),
    ),
} satisfies ToolSpec;

async function inspectArtifact(
  target: string,
  ocrRequested: boolean,
  workspace: string,
): Promise<z.infer<typeof FUNCTIONS_VIEW_IMAGE_OR_DOCUMENT_RESULT_SCHEMA>> {
  const targetPath = path.resolve(workspace, target);

  try {
    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
      return {
        ok: true,
        path: targetPath,
        exists: true,
        kind: "directory" as const,
        media_type: "inode/directory",
        size_bytes: stats.size,
        text: null,
        truncated: false,
        ocr: {
          requested: ocrRequested,
          attempted: false,
          supported: false,
          message: "Directory OCR is not supported.",
        },
      };
    }

    const mediaType = guessMediaType(targetPath);
    const inferredKind = detectKind(targetPath, mediaType);
    const kind =
      inferredKind === "binary" && !(await isBinaryFile(targetPath))
        ? ("text" as const)
        : inferredKind;
    const textResult =
      kind === "text" ? await readTextArtifact(targetPath) : null;

    return {
      ok: true,
      path: targetPath,
      exists: true,
      kind,
      media_type: mediaType,
      size_bytes: stats.size,
      text: textResult?.text ?? null,
      truncated: textResult?.truncated ?? false,
      ocr: {
        requested: ocrRequested,
        attempted: false,
        supported: false,
        message:
          ocrRequested && kind !== "text"
            ? "OCR is not wired into packages/agent yet."
            : null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      path: targetPath,
      exists: false,
      kind: "missing" as const,
      media_type: null,
      size_bytes: null,
      text: null,
      truncated: false,
      ocr: {
        requested: ocrRequested,
        attempted: false,
        supported: false,
        message: null,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readTextArtifact(filePath: string) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const slice = buffer.subarray(0, bytesRead);
    return {
      text: stripBom(slice.toString("utf8")),
      truncated: bytesRead > MAX_TEXT_BYTES,
    };
  } finally {
    await handle.close();
  }
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function guessMediaType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".txt":
    case ".log":
      return "text/plain";
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".json":
    case ".jsonl":
      return "application/json";
    case ".yaml":
    case ".yml":
      return "application/yaml";
    case ".toml":
    case ".ini":
      return "text/plain";
    case ".csv":
      return "text/csv";
    case ".tsv":
      return "text/tab-separated-values";
    case ".html":
    case ".htm":
      return "text/html";
    case ".xml":
      return "application/xml";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "text/javascript";
    case ".jsx":
      return "text/jsx";
    case ".ts":
    case ".tsx":
      return "text/typescript";
    case ".css":
    case ".scss":
    case ".less":
      return "text/css";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    default:
      return null;
  }
}

function detectKind(
  filePath: string,
  mediaType: string | null,
): "text" | "image" | "pdf" | "binary" {
  const ext = path.extname(filePath).toLowerCase();
  if (mediaType === "application/pdf" || ext === ".pdf") {
    return "pdf";
  }
  if (IMAGE_EXTENSIONS.has(ext) || mediaType?.startsWith("image/")) {
    return "image";
  }
  if (TEXT_EXTENSIONS.has(ext) || mediaType?.startsWith("text/")) {
    return "text";
  }
  return "binary";
}

async function isBinaryFile(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(BINARY_SAMPLE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (sample.includes(0)) {
      return true;
    }

    let suspicious = 0;
    for (const byte of sample) {
      if (byte === 9 || byte === 10 || byte === 13) {
        continue;
      }
      if (byte < 32 || byte === 127) {
        suspicious += 1;
      }
    }

    return sample.length > 0 && suspicious / sample.length > 0.2;
  } finally {
    await handle.close();
  }
}
