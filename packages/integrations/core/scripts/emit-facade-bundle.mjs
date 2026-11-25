import { readFile, writeFile } from "node:fs/promises";
import { facadeBundle } from "../dist/facade/index.mjs";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

await writeFile(
  new URL("../dist/facade-bundle.json", import.meta.url),
  `${JSON.stringify(facadeBundle(version), null, 2)}\n`,
);
