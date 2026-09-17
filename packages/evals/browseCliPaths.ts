import { fileURLToPath } from "node:url";
import path from "node:path";

const browseCliRoot = path.dirname(fileURLToPath(import.meta.resolve("browse/package.json")));

export const BROWSE_CLI_ENTRYPOINT = path.join(browseCliRoot, "bin", "run.js");
export const BROWSE_CLI_BUILD_ARTIFACTS = [
  path.join(browseCliRoot, "oclif.manifest.json"),
  path.join(browseCliRoot, "dist", "commands", "open.js"),
];
export const BROWSE_CLI_PACKAGE_JSON = path.join(browseCliRoot, "package.json");
export const BROWSE_SKILL_SOURCE = path.join(browseCliRoot, "skills", "browse", "SKILL.md");

export function createBrowseCliSessionName(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `eval-${process.pid}-${timestamp}-${random}`;
}
