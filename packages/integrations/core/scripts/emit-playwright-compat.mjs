// Writes the Playwright-compatible runtime as one standalone script, so hosts that run
// code through `experimental_batch` ship the same translator the facade's `run` tool
// uses.
import { writeFile } from "node:fs/promises";
import { createPlaywrightCompatRuntime } from "../dist/facade/index.mjs";

await writeFile(
  new URL("../dist/playwright-compat.js", import.meta.url),
  `${createPlaywrightCompatRuntime.toString()}\n`,
);
