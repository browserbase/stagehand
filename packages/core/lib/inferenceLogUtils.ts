import path from "path";
import fs from "fs";

/**
 * Create (or ensure) a parent directory named "inference_summary".
 */
function ensureInferenceSummaryDir(): string {
  const inferenceDir = path.join(process.cwd(), "inference_summary");
  if (!fs.existsSync(inferenceDir)) {
    fs.mkdirSync(inferenceDir, { recursive: true });
  }
  return inferenceDir;
}

/**
 * Appends a new entry to the act_summary.json file, then writes the file back out.
 */
export function appendSummary<T>(inferenceType: string, entry: T) {
  const summaryPath = getSummaryJsonPath(inferenceType);
  const arrayKey = `${inferenceType}_summary`;

  const existingData = readSummaryFile<T>(inferenceType);
  existingData[arrayKey].push(entry);

  fs.writeFileSync(summaryPath, JSON.stringify(existingData, null, 2));
}

/** A simple timestamp utility for filenames. */
function getTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[^0-9T]/g, "")
    .replace("T", "_");
}

/**
 * Writes `data` as JSON into a file in `directory`, using a prefix plus timestamp.
 * Returns both the file name and the timestamp used, so you can log them.
 */
export function writeTimestampedTxtFile(
  directory: string,
  prefix: string,
  data: unknown,
): { fileName: string; timestamp: string } {
  const baseDir = ensureInferenceSummaryDir();

  const subDir = path.join(baseDir, directory);
  if (!fs.existsSync(subDir)) {
    fs.mkdirSync(subDir, { recursive: true });
  }

  const timestamp = getTimestamp();
  const fileName = `${timestamp}_${prefix}.txt`;
  const filePath = path.join(subDir, fileName);

  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2).replace(/\\n/g, "\n"),
  );

  return { fileName, timestamp };
}

/**
 * Returns the path to the `<inferenceType>_summary.json` file.
 *
 * For example, if `inferenceType = "act"`, this will be:
 *   `./inference_summary/act_summary/act_summary.json`
 */
function getSummaryJsonPath(inferenceType: string): string {
  const baseDir = ensureInferenceSummaryDir();
  const subDir = path.join(baseDir, `${inferenceType}_summary`);
  if (!fs.existsSync(subDir)) {
    fs.mkdirSync(subDir, { recursive: true });
  }
  return path.join(subDir, `${inferenceType}_summary.json`);
}

/**
 * Reads the `<inferenceType>_summary.json` file, returning an object
 * with the top-level array named `<inferenceType>_summary`, if it exists.
 *
 * E.g. if inferenceType is "act", we expect a shape like:
 * {
 *   "act_summary": [ ... ]
 * }
 *
 * If the file or array is missing, returns { "<inferenceType>_summary": [] }.
 */
function readSummaryFile<T>(inferenceType: string): Record<string, T[]> {
  const summaryPath = getSummaryJsonPath(inferenceType);

  // The top-level array key, e.g. "act_summary", "observe_summary", "extract_summary"
  const arrayKey = `${inferenceType}_summary`;

  if (!fs.existsSync(summaryPath)) {
    return { [arrayKey]: [] };
  }

  try {
    const raw = fs.readFileSync(summaryPath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray(parsed[arrayKey])
    ) {
      return parsed;
    }
  } catch {
    // If we fail to parse for any reason, fall back to empty array
  }
  return { [arrayKey]: [] };
}
