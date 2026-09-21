import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const EXAMPLE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_DIR = path.resolve(EXAMPLE_DIR, "..", "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..", "..");

/**
 * Loads `.env` by path rather than from the working directory, so the keys are
 * found whether the CLI is started through `pnpm --filter` (cwd is the package)
 * or by file path from the repo root.
 *
 * dotenv never overwrites a variable that is already set, so precedence runs
 * real environment → this package's `.env` → the repo root's `.env`.
 */
export function loadEnv(): void {
  for (const dir of [PACKAGE_DIR, REPO_ROOT]) {
    const file = path.join(dir, ".env");
    if (fs.existsSync(file)) dotenv.config({ path: file, quiet: true });
  }
}

function describeSearch(): string {
  return `Set it in ${path.join(PACKAGE_DIR, ".env")} (copy .env.example), in the repo root .env, or export it.`;
}

/** A key the demo cannot run without, with a message that says where to put it. */
export function requireKey(name: string, why: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  throw new Error(`${name} is not set — ${why}. ${describeSearch()}`);
}

/** The first of `names` that is set, or undefined. */
export function optionalKey(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Like `requireKey`, but any one of several names will do. */
export function requireOneOf(names: string[], why: string): string {
  const value = optionalKey(...names);
  if (value) return value;
  throw new Error(`${names.join(" or ")} is not set — ${why}. ${describeSearch()}`);
}
