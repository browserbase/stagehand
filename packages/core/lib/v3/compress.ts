const LINE_RE = /^(\s*)\[([^\]]+)\]\s+(.+)$/;

interface TreeLine {
  indent: number;
  id: string;
  rest: string;
  raw: string;
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "to",
  "for",
  "in",
  "on",
  "at",
  "with",
  "get",
  "find",
  "click",
  "navigate",
]);

const KEYWORD_EXPANSIONS: Record<string, string[]> = {
  star: ["stars"],
  issue: ["issues"],
  fork: ["forks"],
  release: ["releases"],
  contributor: ["contributors"],
  author: ["authors"],
  title: ["titles"],
};

const INTERACTIVE_ROLE_RE =
  /^(button|link|input|textbox|combobox|checkbox)(:|$)/i;

function parseLine(line: string): TreeLine | null {
  const match = line.match(LINE_RE);
  if (!match) {
    return null;
  }
  return {
    indent: match[1].length,
    id: match[2],
    rest: match[3],
    raw: line,
  };
}

function staticTextValue(rest: string): string {
  return rest.slice("StaticText:".length);
}

function isStaticText(rest: string): boolean {
  return rest.startsWith("StaticText:");
}

function shouldDrop(rest: string): boolean {
  if (/^image:/.test(rest)) {
    return true;
  }
  if (/^LineBreak:/.test(rest)) {
    return true;
  }
  if (/^ListMarker:/.test(rest)) {
    return true;
  }
  if (isStaticText(rest)) {
    const val = staticTextValue(rest);
    if (val === "" || /^\s+$/.test(val)) {
      return true;
    }
  }
  return false;
}

function isPreParent(rest: string): boolean {
  return /\bpre\b/i.test(rest);
}

function findParent(lines: TreeLine[], idx: number, indent: number): number {
  for (let i = idx - 1; i >= 0; i--) {
    if (lines[i].indent < indent) {
      return i;
    }
  }
  return -1;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractKeywords(instruction: string): string[] {
  const keywords = new Set<string>();
  const words = instruction
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9.]/g, ""))
    .filter((w) => w && !STOPWORDS.has(w));

  for (const word of words) {
    keywords.add(word);
    const expansions = KEYWORD_EXPANSIONS[word];
    if (expansions) {
      for (const exp of expansions) {
        keywords.add(exp.toLowerCase());
      }
    }
  }
  return [...keywords];
}

function isInteractiveRole(rest: string): boolean {
  return INTERACTIVE_ROLE_RE.test(rest);
}

function lineHasKeyword(line: string, keywords: string[]): boolean {
  const lower = line.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function scoreLine(line: string, rest: string, keywords: string[]): number {
  const hasKeyword = lineHasKeyword(line, keywords);
  const interactive = isInteractiveRole(rest);

  if (shouldDrop(rest) && !hasKeyword) {
    return 0;
  }
  if (hasKeyword && interactive) {
    return 3;
  }
  if (hasKeyword) {
    return 2;
  }
  if (interactive) {
    return 1;
  }
  return 0;
}

function findParentLineIndex(
  parsed: (TreeLine | null)[],
  idx: number,
): number {
  const indent = parsed[idx]!.indent;
  for (let i = idx - 1; i >= 0; i--) {
    const parent = parsed[i];
    if (parent && parent.indent < indent) {
      return i;
    }
  }
  return -1;
}

/**
 * Scores hybrid accessibility tree lines against the instruction, keeps matching
 * branches (including ancestors), and drops low-value nodes.
 */
export function scoreAndFilterTree(
  tree: string,
  instruction: string,
): string {
  const lines = tree.split("\n");
  const keywords = extractKeywords(instruction);
  const parsed = lines.map((line) => parseLine(line));
  const scores = lines.map((line, i) => {
    const node = parsed[i];
    if (!node) {
      return 0;
    }
    return scoreLine(line, node.rest, keywords);
  });

  const keep = new Array<boolean>(lines.length).fill(false);

  for (let i = 0; i < lines.length; i++) {
    if (scores[i] < 1) {
      continue;
    }
    let idx = i;
    while (idx >= 0) {
      keep[idx] = true;
      const node = parsed[idx];
      if (!node) {
        break;
      }
      idx = findParentLineIndex(parsed, idx);
    }
  }

  const filtered = lines.filter((_, i) => keep[i]).join("\n");
  const originalTokens = estimateTokens(tree);
  const filteredTokens = estimateTokens(filtered);
  if (originalTokens > 0 && filteredTokens < originalTokens * 0.15) {
    return tree;
  }
  return filtered;
}

/**
 * Structural compression of a hybrid accessibility tree: drops noise nodes and
 * merges consecutive StaticText runs under pre parents.
 */
export function compressTree(rawTree: string): string {
  const inputLines = rawTree.split("\n");
  const parsed: (TreeLine | null)[] = inputLines.map((line) => parseLine(line));

  const treeLines: TreeLine[] = [];
  for (const node of parsed) {
    if (node) {
      treeLines.push(node);
    }
  }

  const out: string[] = [];
  let i = 0;

  while (i < treeLines.length) {
    const line = treeLines[i];

    if (!isStaticText(line.rest)) {
      if (!shouldDrop(line.rest)) {
        out.push(line.raw);
      }
      i++;
      continue;
    }

    const indent = line.indent;
    let j = i + 1;
    while (
      j < treeLines.length &&
      treeLines[j].indent === indent &&
      isStaticText(treeLines[j].rest)
    ) {
      j++;
    }

    const runLen = j - i;
    const parentIdx = findParent(treeLines, i, indent);
    const underPre =
      parentIdx >= 0 && isPreParent(treeLines[parentIdx].rest);

    if (runLen >= 2 && underPre) {
      const joined = treeLines
        .slice(i, j)
        .map((l) => staticTextValue(l.rest))
        .join("");
      const spaces = " ".repeat(indent);
      out.push(`${spaces}[${line.id}] StaticText: ${joined}`);
      i = j;
      continue;
    }

    for (let k = i; k < j; k++) {
      if (!shouldDrop(treeLines[k].rest)) {
        out.push(treeLines[k].raw);
      }
    }
    i = j;
  }

  return out.join("\n");
}
