import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  browseVersionFromPublishedPackages,
  renderBrowseFormula,
  sha256Hex,
  writeFormulaIfChanged,
} from "./publish-homebrew.ts";

const sha256 = "8f96e5463ba38f0d1c9e36a2cf375b570804b6662f076051befc36ab053fe106";

describe("browseVersionFromPublishedPackages", () => {
  it("selects a Browse release among other packages", () => {
    expect(
      browseVersionFromPublishedPackages(
        JSON.stringify([
          { name: "@browserbasehq/stagehand", version: "4.1.0" },
          { name: "browse", version: "0.10.0" },
        ]),
      ),
    ).toBe("0.10.0");
  });

  it("returns undefined when Browse was not published", () => {
    expect(
      browseVersionFromPublishedPackages(
        JSON.stringify([{ name: "@browserbasehq/stagehand", version: "4.1.0" }]),
      ),
    ).toBeUndefined();
  });

  it("rejects malformed package data", () => {
    expect(() => browseVersionFromPublishedPackages("{}")).toThrow(
      "Published packages must be a JSON array",
    );
    expect(() =>
      browseVersionFromPublishedPackages(JSON.stringify([{ name: "browse", version: "next" }])),
    ).toThrow("Invalid published Browse version");
  });
});

describe("renderBrowseFormula", () => {
  it("renders the release URL, checksum, and supported platform cleanup", () => {
    const formula = renderBrowseFormula("0.10.0", sha256);

    expect(formula).toContain("browse-0.10.0.tgz");
    expect(formula).toContain(`sha256 "${sha256}"`);
    expect(formula).toContain('depends_on "node"');
    expect(formula).toContain('ENV["BROWSE_LOAD_DOTENV"] = "0"');
    expect(formula).toContain('"#{platform}-#{arch}"');
    expect(formula).toContain(
      '(bin/"browse").write_env_script libexec/"bin/browse", BROWSE_INSTALL_METHOD: "homebrew"',
    );
    expect(formula).toContain("brew install --cask google-chrome");
    expect(formula).toContain("use --remote with");
  });

  it("rejects invalid versions and checksums", () => {
    expect(() => renderBrowseFormula("latest", sha256)).toThrow("Invalid Browse version");
    expect(() => renderBrowseFormula("0.10.0", "invalid")).toThrow("Invalid SHA-256");
  });
});

describe("sha256Hex", () => {
  it("hashes npm tarball bytes", () => {
    expect(sha256Hex(new TextEncoder().encode("browse"))).toBe(
      "25070cd932a7309a6e0bc75ec56f7630a886a93f1a786c9e241fc64175b29a65",
    );
  });
});

describe("writeFormulaIfChanged", () => {
  it("writes a new formula and skips identical content", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "stagehand-homebrew-test-"));
    const file = path.join(directory, "Formula/browse.rb");
    const formula = renderBrowseFormula("0.10.0", sha256);

    try {
      await expect(writeFormulaIfChanged(file, formula)).resolves.toBe(true);
      await expect(readFile(file, "utf8")).resolves.toBe(formula);
      await expect(writeFormulaIfChanged(file, formula)).resolves.toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
