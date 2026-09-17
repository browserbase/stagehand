import { cp, mkdir, rm } from "node:fs/promises";

const source = new URL("../../core/src/", import.meta.url);
const destination = new URL("../extension/lib/core/", import.meta.url);

await rm(destination, { force: true, recursive: true });
for (const file of [
  "facade/contract.ts",
  "facade/runtime.ts",
  "facade/tools.ts",
  "harness/redact.ts",
]) {
  const target = new URL(file, destination);
  await mkdir(new URL(".", target), { recursive: true });
  await cp(new URL(file, source), target);
}
