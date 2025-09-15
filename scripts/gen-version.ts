import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = { version: string };

const __dirname = dirname(fileURLToPath(import.meta.url));
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
