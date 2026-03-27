import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export function getPackageRootDir(): string {
  return packageRoot;
}

export function getDistCliPath(): string {
  return path.join(packageRoot, "dist", "cli.js");
}

export function getSourceCliPath(): string {
  return path.join(packageRoot, "lib", "cli.ts");
}
