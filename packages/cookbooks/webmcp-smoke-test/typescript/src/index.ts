import "dotenv/config";
import { localBrowser, Stagehand } from "@browserbasehq/stagehand";

const WEBMCP_URL =
  process.env.WEBMCP_URL ?? "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/";
const WEBMCP_TOOL = process.env.WEBMCP_TOOL ?? "calculateSum";
const WEBMCP_INPUT = process.env.WEBMCP_INPUT ?? '{"a":19,"b":23}';
const input: unknown = JSON.parse(WEBMCP_INPUT);
if (!input || typeof input !== "object" || Array.isArray(input)) {
  throw new Error("WEBMCP_INPUT must be a JSON object");
}

const browser = await localBrowser.launch({ headless: true });
try {
  const stagehand = await Stagehand.create({ browser });
  try {
    const page = await browser.context.activePage();
    if (!page) throw new Error("No active page");
    await page.goto(WEBMCP_URL);
    const tools = await page.tools({ timeout: 5_000 });
    if (tools.length === 0) {
      throw new Error(
        `No WebMCP tools on ${WEBMCP_URL} (browser opened ${await page.url()}). Check browser support and page registration.`,
      );
    }
    const tool = tools.find((candidate) => candidate.name === WEBMCP_TOOL);
    if (!tool) {
      throw new Error(
        `Expected tool ${WEBMCP_TOOL}, found: ${tools.map((candidate) => candidate.name).join(", ")}`,
      );
    }
    const invocation = await tool.invoke({
      input: input as Record<string, string | number | boolean | null>,
    });
    const result = await invocation.result();
    if (result.status !== "Completed") {
      throw new Error(
        `Tool ${WEBMCP_TOOL} finished with status ${result.status}: ${result.errorText ?? ""}`,
      );
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await stagehand.close();
  }
} finally {
  await browser.close();
}
