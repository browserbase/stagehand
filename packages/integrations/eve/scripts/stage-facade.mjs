import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL("../../core/src/facade/", import.meta.url);
const destination = new URL("../extension/lib/core-facade/", import.meta.url);
const destinationPath = fileURLToPath(destination);

await rm(destinationPath, { force: true, recursive: true });
await mkdir(destinationPath, { recursive: true });
await Promise.all(
  ["contract.ts", "runtime.ts", "tools.ts"].map((file) =>
    cp(new URL(file, source), new URL(file, destination)),
  ),
);
