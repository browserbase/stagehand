import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type PackageJson = { version: string };

const here = path.dirname(path.resolve(process.argv[1] ?? ""));
const pkgPath = path.join(here, "..", "package.json");
const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf8"));

const fullVersion: `${string}` = pkg.version;

const banner = `/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND
 *  Run \`pnpm run gen-version\` to refresh.
 */
export const STAGEHAND_VERSION = "${fullVersion}" as const;
`;

writeFileSync(path.join(here, "..", "lib", "version.ts"), banner);
