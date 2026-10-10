import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function installedSdkVersion(): string {
  let directory = dirname(fileURLToPath(import.meta.resolve("@opencode/sdk")));
  while (true) {
    try {
      const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      if (pkg.name === "@opencode/sdk" && typeof pkg.version === "string") return pkg.version;
    } catch {
      // The entrypoint can be nested below the package root.
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Cannot determine the installed OpenCode SDK version.");
    directory = parent;
  }
}

export const OPENCODE_SDK_VERSION = installedSdkVersion();
