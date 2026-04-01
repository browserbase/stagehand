import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Resolve a --context-id value that may be a named label.
 *
 * Label files live at:
 *   <configDir>/contexts/<label>  →  raw UUID
 *
 * The base path respects BROWSERBASE_CONFIG_DIR env var.
 */
export async function resolveContextLabel(value: string): Promise<string> {
  // Raw UUIDs and ctx_ prefixes pass through
  if (/^[0-9a-f-]{36}$/i.test(value) || value.startsWith("ctx_")) {
    return value;
  }
  // Look up as a label file
  const configDir =
    process.env.BROWSERBASE_CONFIG_DIR ||
    path.join(os.homedir(), ".config", "browserbase");
  const labelPath = path.join(configDir, "contexts", value);
  try {
    const id = (await fs.readFile(labelPath, "utf-8")).trim();
    if (id) {
      return id;
    }
  } catch {
    // Label file doesn't exist – fall through
  }
  // Return as-is (might be a raw ID in a format we don't recognize)
  return value;
}
