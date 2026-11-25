export interface SnapshotFilterOptions {
  compact?: boolean;
  filter?: string;
  maxDepth?: number;
}

export function formatSnapshotTree(tree: string, options: SnapshotFilterOptions = {}): string {
  let lines = tree.split("\n");

  if (options.maxDepth !== undefined) {
    lines = lines.filter((line) => lineDepth(line) <= options.maxDepth!);
  }

  if (options.filter) {
    lines = filterLinesWithAncestors(lines, options.filter);
  }

  if (options.compact) {
    lines = compactLines(lines);
  }

  return lines.join("\n").trim();
}

function filterLinesWithAncestors(lines: string[], pattern: string): string[] {
  const matcher = createMatcher(pattern);
  return keepLinesWithAncestors(lines, matcher);
}

function keepLinesWithAncestors(lines: string[], shouldKeep: (line: string) => boolean): string[] {
  const keep = new Set<number>();
  const ancestors: Array<{ index: number; depth: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const depth = lineDepth(line);
    while (ancestors.length > 0 && ancestors[ancestors.length - 1]!.depth >= depth) {
      ancestors.pop();
    }
    if (shouldKeep(line)) {
      keep.add(index);
      for (let i = ancestors.length - 1; i >= 0; i -= 1) {
        const ancestorIndex = ancestors[i]!.index;
        if (keep.has(ancestorIndex)) break;
        keep.add(ancestorIndex);
      }
    }
    ancestors.push({ index, depth });
  }

  return lines.filter((_, index) => keep.has(index));
}

function createMatcher(pattern: string): (line: string) => boolean {
  const regex = parseRegex(pattern);
  if (regex) {
    return (line) => {
      regex.lastIndex = 0;
      return regex.test(line);
    };
  }

  const needle = pattern.toLowerCase();
  return (line) => line.toLowerCase().includes(needle);
}

function parseRegex(pattern: string): RegExp | null {
  const match = pattern.match(/^\/(.+)\/([a-z]*)$/i);
  if (!match) return null;
  try {
    return new RegExp(match[1] ?? "", match[2] ?? "");
  } catch {
    return null;
  }
}

function compactLines(lines: string[]): string[] {
  const compacted = keepLinesWithAncestors(lines, isUsefulSnapshotLine);
  return compacted.length > 0 ? compacted : lines;
}

function isUsefulSnapshotLine(line: string): boolean {
  return (
    /\[\d+-\d+]/.test(line) ||
    line.includes(": ") ||
    /\b(button|link|textbox|checkbox|radio|combobox)\b/i.test(line)
  );
}

function lineDepth(line: string): number {
  const match = line.match(/^\s*/);
  return Math.floor((match?.[0].length ?? 0) / 2);
}
