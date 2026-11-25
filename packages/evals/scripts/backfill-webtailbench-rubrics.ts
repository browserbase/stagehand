import fs from "node:fs/promises";
import path from "node:path";

const HF_URL =
  "https://huggingface.co/datasets/microsoft/WebTailBench/resolve/main/WebTailBench-v1-rubrics.tsv";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const JSONL_PATH = path.join(
  REPO_ROOT,
  "packages",
  "evals",
  "datasets",
  "webtailbench",
  "WebTailBench_data.jsonl",
);

interface RawRubric {
  items: Array<Record<string, unknown>>;
}

interface LocalRow {
  id: string;
  category?: string;
  ques: string;
  web?: string;
  precomputed_rubric?: RawRubric;
}

function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw) continue;
    const cols: string[] = [];
    let i = 0;
    while (i < raw.length) {
      if (raw[i] === "\t") {
        cols.push("");
        i++;
        continue;
      }
      let col = "";
      if (raw[i] === '"') {
        i++;
        while (i < raw.length) {
          if (raw[i] === '"') {
            if (raw[i + 1] === '"') {
              col += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            col += raw[i];
            i++;
          }
        }
      } else {
        const tabIdx = raw.indexOf("\t", i);
        if (tabIdx === -1) {
          col = raw.slice(i);
          i = raw.length;
        } else {
          col = raw.slice(i, tabIdx);
          i = tabIdx;
        }
      }
      cols.push(col);
      if (raw[i] === "\t") i++;
    }
    rows.push(cols);
  }
  return rows;
}

async function main(): Promise<void> {
  console.log(`▸ fetching ${HF_URL}`);
  const res = await fetch(HF_URL);
  if (!res.ok) {
    throw new Error(`HF fetch failed: ${res.status} ${res.statusText}`);
  }
  const tsv = await res.text();
  console.log(`  ✓ downloaded ${tsv.length} bytes`);

  const rows = parseTsv(tsv);
  const header = rows[0];
  const idIdx = header.indexOf("id");
  const rubricIdx = header.indexOf("precomputed_rubric");
  if (idIdx === -1 || rubricIdx === -1) {
    throw new Error(
      `unexpected TSV header: ${header.join(", ")} (need 'id' and 'precomputed_rubric')`,
    );
  }

  const rubricsById = new Map<string, RawRubric>();
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (!cols[idIdx]) continue;
    try {
      const parsed = JSON.parse(cols[rubricIdx]) as RawRubric;
      rubricsById.set(cols[idIdx], parsed);
    } catch (e) {
      console.warn(
        `  ! row ${i} (id=${cols[idIdx]}) — invalid JSON in precomputed_rubric: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
  console.log(`  ✓ parsed ${rubricsById.size} rubrics`);

  const jsonlRaw = await fs.readFile(JSONL_PATH, "utf8");
  const inLines = jsonlRaw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  console.log(`▸ joining into ${inLines.length} local rows`);

  let matched = 0;
  let missing = 0;
  const out: string[] = [];
  for (const line of inLines) {
    const row = JSON.parse(line) as LocalRow;
    const rubric = rubricsById.get(row.id);
    if (rubric) {
      row.precomputed_rubric = rubric;
      matched++;
    } else {
      missing++;
    }
    out.push(JSON.stringify(row));
  }

  console.log(
    `  ✓ matched ${matched}/${inLines.length} rows; ${missing} unmatched (will fall back to generated rubrics)`,
  );

  await fs.writeFile(JSONL_PATH, out.join("\n") + "\n", "utf8");
  console.log(`✅ wrote ${JSONL_PATH}`);
}

main().catch((err) => {
  console.error("❌ backfill failed:", err);
  process.exit(1);
});
