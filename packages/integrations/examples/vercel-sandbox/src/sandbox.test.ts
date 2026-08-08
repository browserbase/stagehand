import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

import { Sandbox } from "@vercel/sandbox";
import { createStagehandSandbox } from "./sandbox.js";

const dependencies = {
  "@browserbasehq/stagehand": "file:../packages/stagehand.tgz",
  "@browserbasehq/stagehand-codemode": "file:../packages/stagehand-codemode.tgz",
  supergateway: "3.4.3",
};

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
  const artifactRoot = await writeArtifacts("https://packages.example.test/supergateway.tgz");
  try {
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

void test("runtime lock rejects non-string resolved values", async () => {
  for (const resolved of [null, 42, { source: "registry" }]) {
    const artifactRoot = await writeArtifacts(resolved);
    try {
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
  }
});

void test("Sandbox.create receives only allowlisted Vercel credentials", async () => {
  const createOptions = await captureSandboxCreateOptions({
    teamId: "expected-team",
    projectId: "expected-project",
    token: "expected-token",
    networkPolicy: "deny-all",
  } as NonNullable<Parameters<typeof createStagehandSandbox>[0]["vercelCredentials"]>);
  const forwardedOptions = createOptions as typeof createOptions & {
    projectId: string;
    teamId: string;
    token: string;
  };
  assert.equal(forwardedOptions.teamId, "expected-team");
  assert.equal(forwardedOptions.projectId, "expected-project");
  assert.equal(forwardedOptions.token, "expected-token");
  assert.equal(createOptions.networkPolicy, "allow-all");
  assert.deepEqual(createOptions.tags, { purpose: "stagehand-codemode-mcp" });
});

void test("Sandbox.create preserves SDK credential discovery when credentials are omitted", async () => {
  const createOptions = await captureSandboxCreateOptions();
  assert.equal(Object.hasOwn(createOptions, "teamId"), false);
  assert.equal(Object.hasOwn(createOptions, "projectId"), false);
  assert.equal(Object.hasOwn(createOptions, "token"), false);
});

async function captureSandboxCreateOptions(
  vercelCredentials?: Parameters<typeof createStagehandSandbox>[0]["vercelCredentials"],
): Promise<Parameters<typeof Sandbox.create>[0]> {
  const artifactRoot = await writeArtifacts("https://registry.npmjs.org/supergateway.tgz");
  let createOptions: Parameters<typeof Sandbox.create>[0] | undefined;
  const fetchMock = mock.method(globalThis, "fetch", async (input) => {
    const url = input.toString();
    if (url.endsWith("/v1/sessions")) {
      return {
        ok: true,
        json: async () => ({
          id: "discovery-session",
          connectUrl: "wss://connect.browserbase.com/devtools/browser/test",
        }),
      } as Response;
    }
    return { ok: true } as Response;
  });
  const createMock = mock.method(Sandbox, "create", async (options) => {
    createOptions = options;
    throw new Error("stop after inspecting create options");
  });

  try {
    await assert.rejects(
      createStagehandSandbox({
        packageArtifactsPath: artifactRoot,
        browserbaseApiKey: "unused-test-key",
        browserbaseProjectId: "unused-test-project",
        vercelCredentials,
      }),
      { name: "StagehandSandboxSetupError" },
    );
    assert.ok(createOptions);
    return createOptions;
  } finally {
    createMock.mock.restore();
    fetchMock.mock.restore();
    await rm(artifactRoot, { force: true, recursive: true });
  }
}

async function writeArtifacts(resolved: unknown): Promise<string> {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "stagehand-artifacts-"));
  const packageRoot = path.join(artifactRoot, "packages");
  const runtimeRoot = path.join(artifactRoot, "runtime");
  await Promise.all([mkdir(packageRoot), mkdir(runtimeRoot)]);
  await Promise.all([
    writeFile(path.join(packageRoot, "stagehand.tgz"), Buffer.from([0x1f, 0x8b])),
    writeFile(path.join(packageRoot, "stagehand-codemode.tgz"), Buffer.from([0x1f, 0x8b])),
    writeFile(path.join(runtimeRoot, "package.json"), JSON.stringify({ dependencies })),
    writeFile(
      path.join(runtimeRoot, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { dependencies },
          "node_modules/supergateway": { resolved },
        },
      }),
    ),
  ]);
  return artifactRoot;
}
