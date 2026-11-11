import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

function installedSdkVersion(): string {
  let directory = dirname(createRequire(import.meta.url).resolve("@cursor/sdk"));
  while (true) {
    try {
      const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      if (pkg.name === "@cursor/sdk" && typeof pkg.version === "string") return pkg.version;
    } catch {
      // The entrypoint can be nested below the package root.
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Cannot determine the installed Cursor SDK version.");
    directory = parent;
  }
}

export const CURSOR_SDK_VERSION = installedSdkVersion();
