// The stable entry point agents launch, copied to the runtime root as main.mjs.
// Setup installs each runtime into a new versions/<id> directory and switches
// to it by atomically replacing current.json, so this path never goes missing.
import { readFile } from "node:fs/promises";

const { version } = JSON.parse(
  await readFile(new URL("./current.json", import.meta.url), "utf8"),
) as { version: string };
await import(new URL(`./versions/${version}/main.js`, import.meta.url).href);
