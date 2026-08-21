/**
 * Minimal observe repro for the auto-mode V1 eval: runs a single observe()
 * against the eval Google page with the given model and prints the RAW error
 * (NoObjectGeneratedError carries the model's text + zod issues), which the
 * eval TUI truncates.
 *
 * Usage (from stagehand repo root):
 *   node --env-file=.env --import tsx packages/evals/scripts/tmp-observe-repro.ts gateway/zai/glm-4.7-flash
 */
import { V3 } from "@browserbasehq/stagehand";

const model = process.argv[2] ?? "gateway/zai/glm-4.7-flash";
console.log(`model: ${model}`);

const v3 = new V3({
  env: "BROWSERBASE",
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  model,
  disableAPI: true,
  disablePino: true,
  verbose: 0,
  serverCache: false,
});

try {
  await v3.init();
  const page = v3.context.pages()[0];
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/google/",
  );
  const result = await v3.observe("Find the search input field");
  console.log("OK:", JSON.stringify(result).slice(0, 500));
} catch (error) {
  const e = error as Error & {
    text?: string;
    cause?: unknown;
    finishReason?: string;
    usage?: unknown;
  };
  console.log("ERROR name:", e.name);
  console.log("message:", e.message?.slice(0, 500));
  if (e.finishReason) console.log("finishReason:", e.finishReason);
  if (e.text) console.log("MODEL TEXT (first 1200 chars):", e.text.slice(0, 1200));
  if (e.cause) console.log("CAUSE:", String(e.cause).slice(0, 1500));
} finally {
  await v3.close().catch(() => {});
}
