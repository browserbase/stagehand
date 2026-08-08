import assert from "node:assert/strict";
import test from "node:test";

import { createStagehandSandbox } from "./sandbox.js";

void test("invalid package artifacts fail before any sandbox is created", async () => {
  await assert.rejects(
    createStagehandSandbox({
      packageArtifactsPath: "relative-artifacts",
      browserbaseApiKey: "unused-test-key",
      browserbaseProjectId: "unused-test-project",
    }),
    {
      name: "StagehandPackageArtifactError",
      message: "Stagehand package artifact is invalid.",
    },
  );
});
