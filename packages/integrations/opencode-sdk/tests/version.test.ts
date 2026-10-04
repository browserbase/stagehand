import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OPENCODE_SDK_PACKAGE,
  OPENCODE_SDK_VERSION,
  readInstalledOpenCodeSdk,
} from "../src/version.js";

describe("installed @opencode/sdk", () => {
  it("reads the npm package from this workspace's node_modules, not a PATH CLI", () => {
    const installed = readInstalledOpenCodeSdk();
    const pkg = JSON.parse(readFileSync(join(installed.root, "package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    expect(installed.name).toBe(OPENCODE_SDK_PACKAGE);
    expect(installed.version).toBe(OPENCODE_SDK_VERSION);
    expect(pkg.name).toBe(OPENCODE_SDK_PACKAGE);
    expect(pkg.version).toBe(OPENCODE_SDK_VERSION);
    expect(installed.root.includes(`${join("node_modules", "@opencode", "sdk")}`)).toBe(true);
    expect(existsSync(join(installed.root, "dist", "index.js"))).toBe(true);
  });
});
