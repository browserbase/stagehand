// Writes the Playwright-compatible runtime as one standalone script, so SDKs that run
// code through `experimental_batch` (the Python SDK) ship the same translator the
// facade's `run` tool uses.
import { writeFile } from "node:fs/promises";
import { createPlaywrightCompatRuntime } from "../dist/facade/index.mjs";

await writeFile(
  new URL("../dist/playwright-compat.js", import.meta.url),
  `${createPlaywrightCompatRuntime.toString()}\n`,
);
