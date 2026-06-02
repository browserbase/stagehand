import { describe, expect, it } from "vitest";

import {
  autoSelectRemoteTarget,
  remoteDoctorCheck,
  remoteStagehandOptions,
  resolveExplicitRemoteTarget,
} from "../src/lib/driver/remote.disabled.js";

// Guards the local-only contract: the disabled remote capability must never
// reach Browserbase. If this drifts, a local-only build could silently regain
// a cloud code path.
describe("remote.disabled (local-only capability)", () => {
  it("never auto-selects a remote target", () => {
    expect(autoSelectRemoteTarget()).toBeNull();
  });

  it("refuses an explicit --remote target", () => {
    expect(() => resolveExplicitRemoteTarget()).toThrow(/disabled/i);
  });

  it("refuses to build remote Stagehand options", () => {
    expect(() => remoteStagehandOptions()).toThrow(/disabled/i);
  });

  it("reports remote as disabled in doctor without reading any key", () => {
    const result = remoteDoctorCheck();
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/disabled/i);
  });

  it("contains no BROWSERBASE_API_KEY reference in its source", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const source = await readFile(
      fileURLToPath(
        new URL("../src/lib/driver/remote.disabled.ts", import.meta.url),
      ),
      "utf8",
    );
    expect(source).not.toContain("BROWSERBASE_API_KEY");
  });
});
