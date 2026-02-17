import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error - __dirname is not available in ES modules, using fileURLToPath workaround
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, "../openapi.v3.yaml");

const OPENAPI_YAML = `openapi: "3.1.0"
info:
  title: "Stagehand API"
  version: "4.0.0"
  description: "Event-driven Stagehand v4 API"
paths:
  /v4/sessions:
    post:
      summary: "Create session"
    get:
      summary: "List sessions"
  /v4/sessions/{sessionId}:
    get:
      summary: "Get session"
  /v4/agent:
    get:
      summary: "List agents"
    post:
      summary: "Create agent task"
  /v4/stagehand/{kind}:
    post:
      summary: "Run stagehand step"
  /v4/understudy/{kind}:
    post:
      summary: "Run understudy step"
  /v4/browser:
    get:
      summary: "List browsers"
    post:
      summary: "Browser operations"
`;

async function main() {
  await writeFile(OUTPUT_PATH, OPENAPI_YAML, "utf8");
  console.log(`OpenAPI spec written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
