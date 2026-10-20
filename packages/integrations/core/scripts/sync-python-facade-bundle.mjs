// Copies the built facade bundle into the Python package, which ships it as
// package data. tests/facade-python-bundle.test.ts fails while they differ.
import { copyFile } from "node:fs/promises";

await copyFile(
  new URL("../dist/facade-bundle.json", import.meta.url),
  new URL("../python/src/stagehand_integrations/facade/_bundle.json", import.meta.url),
);
