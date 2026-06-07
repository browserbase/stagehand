import { describe, expect, it } from "vitest";

import { buildManagedLocalLaunchOptions } from "../src/lib/driver/launch-options.js";

describe("buildManagedLocalLaunchOptions", () => {
  it("returns an empty object when launch options are omitted", () => {
    expect(buildManagedLocalLaunchOptions()).toEqual({});
  });

  it("maps managed-local launch options into Stagehand options", () => {
    expect(
      buildManagedLocalLaunchOptions({
        args: ["--renderer-process-limit=6"],
        connectTimeoutMs: 30_000,
        executablePath: "/opt/chrome/chrome",
      }),
    ).toEqual({
      args: ["--renderer-process-limit=6"],
      connectTimeoutMs: 30_000,
      executablePath: "/opt/chrome/chrome",
    });
  });
});
