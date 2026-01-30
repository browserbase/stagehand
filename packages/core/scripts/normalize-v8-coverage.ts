/**
 * Normalize V8 coverage ranges using sourcemaps to avoid offset/1x floor issues.
 *
 * Prereqs: V8 coverage JSON files plus JS files with inline or external sourcemaps.
 * Args: --coverage-dir <dir> (or NODE_V8_COVERAGE).
 * Env: NODE_V8_COVERAGE, V8_COVERAGE_SCAN_LIMIT.
 * Example: tsx packages/core/scripts/normalize-v8-coverage.ts --coverage-dir coverage/e2e-local
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer } from "source-map";
import { findRepoRoot } from "./test-utils";

type CoverageRange = {
  startOffset: number;
  endOffset: number;
  count: number;
};

type CoverageEntry = {
  url?: string;
  functions?: Array<{
    ranges?: CoverageRange[];
  }>;
};

type CoverageFile = {
  result?: CoverageEntry[];
};

const toFilePath = (urlOrPath: string): string | null => {
  if (!urlOrPath) return null;
  if (urlOrPath.startsWith("node:")) return null;
  if (urlOrPath.startsWith("file:")) {
    try {
      return fileURLToPath(urlOrPath);
    } catch {
      return null;
    }
  }
  return path.isAbsolute(urlOrPath) ? urlOrPath : null;
};

const readSourceMap = (jsPath: string): Record<string, unknown> | null => {
  if (!fs.existsSync(jsPath)) return null;
  const source = fs.readFileSync(jsPath, "utf8");
  const inlineMatch = source.match(
    /sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/,
  );
  if (inlineMatch) {
    return JSON.parse(
      Buffer.from(inlineMatch[1], "base64").toString("utf8"),
    ) as Record<string, unknown>;
  }
  const mapMatch = source.match(/sourceMappingURL=([^\s]+)/);
  if (!mapMatch) return null;
  const mapFile = mapMatch[1].trim();
  if (mapFile.startsWith("data:")) return null;
  const mapPath = path.resolve(path.dirname(jsPath), mapFile);
  if (!fs.existsSync(mapPath)) return null;
  return JSON.parse(fs.readFileSync(mapPath, "utf8")) as Record<
    string,
    unknown
  >;
};

const buildLineStarts = (source: string) => {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }
  return lineStarts;
};

const offsetToLineCol = (lineStarts: number[], offset: number) => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid];
    const next = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Infinity;
    if (start <= offset && offset < next) {
      return { line: mid + 1, column: offset - start };
    }
    if (start > offset) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return { line: 1, column: 0 };
};

const lineColToOffset = (
  lineStarts: number[],
  line: number,
  column: number,
  sourceLength: number,
) => {
  const lineIndex = Math.max(0, line - 1);
  const lineStart = lineStarts[lineIndex] ?? 0;
  const lineEnd =
    lineIndex + 1 < lineStarts.length
      ? lineStarts[lineIndex + 1] - 1
      : sourceLength;
  const clampedColumn = Math.max(0, Math.min(column, lineEnd - lineStart));
  return lineStart + clampedColumn;
};
type NormalizerOptions = {
  coverageDir: string;
  maxScan: number;
};

type SourceContext = {
  lineStarts: number[];
  sourceLength: number;
  consumer: SourceMapConsumer;
};

const normalizeRange = (
  range: CoverageRange,
  ctx: SourceContext,
  options: NormalizerOptions,
) => {
  if (range.endOffset <= range.startOffset) return false;
  const maxScan = Math.min(
    options.maxScan,
    Math.max(0, range.endOffset - range.startOffset),
  );

  const startPos = offsetToLineCol(ctx.lineStarts, range.startOffset);
  let start = ctx.consumer.originalPositionFor(startPos);
  let startOffset = range.startOffset;
  if (!start.source) {
    let found: { source: string; offset: number } | null = null;
    const limit = Math.min(range.endOffset, range.startOffset + maxScan);
    for (let off = range.startOffset; off <= limit; off++) {
      const pos = offsetToLineCol(ctx.lineStarts, off);
      const mapped = ctx.consumer.originalPositionFor(pos);
      if (mapped.source) {
        found = { source: mapped.source, offset: off };
        break;
      }
    }
    if (!found) return false;
    start = { ...start, source: found.source };
    startOffset = found.offset;
  }

  const endPos = offsetToLineCol(ctx.lineStarts, range.endOffset);
  const end = ctx.consumer.originalPositionFor(endPos);
  let endOffset = range.endOffset;
  if (!end.source || end.source !== start.source) {
    let found: number | null = null;
    const limit = Math.max(range.startOffset, range.endOffset - maxScan);
    for (let off = range.endOffset; off >= limit; off--) {
      const pos = offsetToLineCol(ctx.lineStarts, off);
      const mapped = ctx.consumer.originalPositionFor(pos);
      if (mapped.source === start.source) {
        found = off;
        break;
      }
    }
    if (found === null) return false;
    endOffset = found;
  }

  if (range.count === 0 && end.source === start.source) {
    const genStart = ctx.consumer.generatedPositionFor({
      source: start.source,
      line: start.line ?? 1,
      column: 0,
      bias: SourceMapConsumer.LEAST_UPPER_BOUND,
    });
    const genEnd = ctx.consumer.generatedPositionFor({
      source: start.source,
      line: end.line ?? start.line ?? 1,
      column: Number.MAX_SAFE_INTEGER,
      bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
    });
    if (genStart.line && genEnd.line) {
      const expandedStart = lineColToOffset(
        ctx.lineStarts,
        genStart.line,
        genStart.column ?? 0,
        ctx.sourceLength,
      );
      const expandedEnd = lineColToOffset(
        ctx.lineStarts,
        genEnd.line,
        genEnd.column ?? 0,
        ctx.sourceLength,
      );
      startOffset = Math.min(startOffset, expandedStart);
      endOffset = Math.max(endOffset, expandedEnd);
    }
  }

  if (endOffset <= startOffset) return false;
  if (startOffset !== range.startOffset || endOffset !== range.endOffset) {
    range.startOffset = startOffset;
    range.endOffset = endOffset;
    return true;
  }
  return false;
};

const normalizeCoverageDir = async (options: NormalizerOptions) => {
  if (!fs.existsSync(options.coverageDir)) return;
  const jsonFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        jsonFiles.push(full);
      }
    }
  };
  walk(options.coverageDir);
  if (jsonFiles.length === 0) return;

  const sourceCache = new Map<string, SourceContext | null>();

  for (const file of jsonFiles) {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as CoverageFile;
    if (!Array.isArray(data.result)) continue;
    let updated = false;

    for (const entry of data.result) {
      const jsPath = entry.url ? toFilePath(entry.url) : null;
      if (!jsPath) continue;
      let ctx = sourceCache.get(jsPath);
      if (ctx === undefined) {
        const map = readSourceMap(jsPath);
        if (!map) {
          sourceCache.set(jsPath, null);
          continue;
        }
        const source = fs.readFileSync(jsPath, "utf8");
        ctx = {
          lineStarts: buildLineStarts(source),
          sourceLength: source.length,
          consumer: await new SourceMapConsumer(map),
        };
        sourceCache.set(jsPath, ctx);
      }
      if (!ctx) continue;
      if (!entry?.functions) continue;
      for (const block of entry.functions) {
        if (!block?.ranges) continue;
        for (const range of block.ranges) {
          if (normalizeRange(range, ctx, options)) {
            updated = true;
          }
        }
      }
    }

    if (updated) {
      fs.writeFileSync(file, JSON.stringify(data));
    }
  }

  for (const ctx of sourceCache.values()) {
    ctx?.consumer.destroy();
  }
};

export const normalizeV8Coverage = async (coverageDir: string) => {
  const repoRoot = findRepoRoot(process.cwd());
  const resolvedDir = path.resolve(repoRoot, coverageDir);
  const maxScan = Number(process.env.V8_COVERAGE_SCAN_LIMIT ?? 20000);
  await normalizeCoverageDir({ coverageDir: resolvedDir, maxScan });
};

export default normalizeV8Coverage;

const main = async () => {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--coverage-dir");
  const coverageDir =
    (idx >= 0 ? args[idx + 1] : undefined) ?? process.env.NODE_V8_COVERAGE;
  if (!coverageDir) {
    console.error(
      "Missing coverage dir (use --coverage-dir or NODE_V8_COVERAGE).",
    );
    process.exit(1);
  }
  await normalizeV8Coverage(coverageDir);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
