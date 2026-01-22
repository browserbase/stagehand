/**
 * Example: Run a Stagehand agent and persist Flow Logger events to a file.
 *
 * This shows how to capture all Flow Logger events (LLM, AgentTask, StagehandStep,
 * UnderstudyAction, CDP, etc.) and optionally filter by category.
 */
import fs from "node:fs";
import path from "node:path";
import { Stagehand } from "../lib/v3";

function getLatestSessionDir(sessionsRoot: string): string | null {
  const latestPath = path.join(sessionsRoot, "latest");
  if (fs.existsSync(latestPath)) {
    return latestPath;
  }

  if (!fs.existsSync(sessionsRoot)) return null;
  const entries = fs
    .readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "latest");
  if (entries.length === 0) return null;

  const sorted = entries
    .map((d) => {
      const full = path.join(sessionsRoot, d.name);
      const stat = fs.statSync(full);
      return { full, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return sorted[0]?.full ?? null;
}

async function main() {
  const configDir = path.resolve(process.cwd(), "stagehand-flow-logs");
  process.env.BROWSERBASE_CONFIG_DIR = configDir;

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
  });

  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];
    await page.goto("https://www.google.com");

    const agent = stagehand.agent();
    await agent.execute({
      instruction:
        "Search for Browserbase and stop after the results are visible.",
      maxSteps: 10,
    });
  } finally {
    await stagehand.close();
  }

  const sessionsRoot = path.join(configDir, "sessions");
  const sessionDir = getLatestSessionDir(sessionsRoot);
  if (!sessionDir) {
    throw new Error("No session directory found.");
  }

  const jsonlPath = path.join(sessionDir, "session_events.jsonl");
  if (!fs.existsSync(jsonlPath)) {
    throw new Error(`Missing session_events.jsonl at ${jsonlPath}`);
  }

  const raw = fs.readFileSync(jsonlPath, "utf-8").trim();
  const lines = raw.length > 0 ? raw.split("\n") : [];

  // Optional: filter to just a subset of categories
  // const filterCategories = new Set(["LLM", "AgentTask", "StagehandStep", "UnderstudyAction"]);
  const filterCategories: Set<string> | null = null;

  const filtered = filterCategories
    ? lines.filter((line) => {
        try {
          const evt = JSON.parse(line) as { category?: string };
          return !!evt.category && filterCategories.has(evt.category);
        } catch {
          return false;
        }
      })
    : lines;

  const outputPath = path.resolve(process.cwd(), "flow_log_events.jsonl");
  fs.writeFileSync(outputPath, filtered.join("\n") + "\n", "utf-8");

  console.log(`Wrote ${filtered.length} events to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
