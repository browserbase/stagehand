import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

void test("runtime lock rejects dependency sources outside file and the npm registry", async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "stagehand-artifacts-"));
  try {
    const runtimeRoot = path.join(artifactRoot, "runtime");
    await mkdir(runtimeRoot);
    const dependencies = {
      "@browserbasehq/stagehand": "file:../packages/stagehand.tgz",
      "@browserbasehq/stagehand-codemode": "file:../packages/stagehand-codemode.tgz",
      supergateway: "3.4.3",
    };
    await writeFile(path.join(runtimeRoot, "package.json"), JSON.stringify({ dependencies }));
    await writeFile(
      path.join(runtimeRoot, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { dependencies },
          "node_modules/supergateway": {
            resolved: "https://packages.example.test/supergateway.tgz",
          },
        },
      }),
    );

    await assert.rejects(
      createStagehandSandbox({
        packageArtifactsPath: artifactRoot,
        browserbaseApiKey: "unused-test-key",
        browserbaseProjectId: "unused-test-project",
      }),
      {
        name: "StagehandPackageArtifactError",
        message: "Stagehand package artifact is invalid.",
      },
    );
  } finally {
    await rm(artifactRoot, { force: true, recursive: true });
  }
});
