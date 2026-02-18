import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = { version: string };

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, "..", "package.json");
const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf8"));

const fullVersion: `${string}` = pkg.version;

const banner = `/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND
 *  Run \`pnpm run gen-version\` to refresh.
 */
export const STAGEHAND_VERSION = "${fullVersion}" as const;
`;

writeFileSync(join(here, "..", "lib", "version.ts"), banner);
