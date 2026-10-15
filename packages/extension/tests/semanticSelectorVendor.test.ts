import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import provenance from "../dom/locatorScripts/vendor/playwright/provenance.json" with { type: "json" };

const vendor = new URL("../dom/locatorScripts/vendor/playwright/", import.meta.url);

describe("Playwright semantic selector provenance", () => {
  it.each(provenance.files)("preserves upstream $name except declared imports", (file) => {
    let source = readFileSync(new URL(file.name, vendor), "utf8");
    if ("adaptationNotice" in file && file.adaptationNotice) {
      source = source.replace(file.adaptationNotice, "");
    }
    for (const [upstream, local] of Object.entries(file.importRewrites)) {
      source = source.replaceAll(`from '${local}'`, `from '${upstream}'`);
    }
    if ("typeAnnotations" in file && file.typeAnnotations) {
      for (const [upstream, local] of Object.entries(file.typeAnnotations)) {
        source = source.replaceAll(local, upstream);
      }
    }
    if ("normalizedCRLF" in file && file.normalizedCRLF) source = source.replaceAll("\n", "\r\n");
    expect(createHash("sha256").update(source).digest("hex")).toBe(file.sha256);
  });

  it("pins the browser parity oracle to the same release as the vendored code", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { devDependencies: Record<string, string> };
    expect(packageJson.devDependencies["playwright-semantic-oracle"]).toBe(
      `npm:playwright-core@${provenance.version}`,
    );
    expect(provenance.commit).toBe("cfe490d941f992655948eee8fd4fd94e1c4234bf");
  });
});
