import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildBrowseCliContractFromManifest,
  defaultManifestPath,
} from "../../scripts/generateBrowseCliContract.js";
import { BROWSE_CLI_CONTRACT } from "../../core/tools/browseCliContract.generated.js";

describe("browse CLI contract staleness guard", () => {
  it("matches a fresh build from packages/cli/oclif.manifest.json", () => {
    const manifestPath = defaultManifestPath();
    if (!fs.existsSync(manifestPath)) {
      throw new Error(
        `browse CLI manifest not found at ${manifestPath}. Run pnpm --dir packages/cli build first.`,
      );
    }

    const fresh = buildBrowseCliContractFromManifest(manifestPath);
    expect(BROWSE_CLI_CONTRACT).toEqual(fresh);
  });

  it("still declares the commands this package's browse_cli tool depends on", () => {
    for (const commandId of [
      "open",
      "status",
      "stop",
      "tab:new",
      "tab:list",
      "tab:switch",
      "tab:close",
      "mouse:click",
      "mouse:hover",
      "mouse:scroll",
      "click",
      "press",
      "type",
      "fill",
      "get",
      "is",
      "wait",
      "screenshot",
      "viewport",
      "snapshot",
      "eval",
      "back",
      "forward",
      "reload",
    ]) {
      expect(BROWSE_CLI_CONTRACT).toHaveProperty(commandId);
    }
  });
});
