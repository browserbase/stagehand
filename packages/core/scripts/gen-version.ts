import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type PackageJson = { version: string };

const pkgPath = join(__dirname, "..", "package.json");
const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf8"));

const fullVersion: `${string}` = pkg.version;

const banner = `/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND
 *  Run \`pnpm run gen-version\` to refresh.
 */
export const STAGEHAND_VERSION = "${fullVersion}" as const;
`;

writeFileSync(join(__dirname, "..", "lib", "version.ts"), banner);
