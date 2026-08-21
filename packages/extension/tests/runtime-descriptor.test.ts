import { describe, expect, it } from "vitest";
import { RuntimeDescriptorSchema, STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.ts";
import extensionPackageJson from "../package.json" with { type: "json" };
import {
  startStagehandServiceWorker,
  type StagehandServiceWorkerScope,
} from "../service-worker.ts";
import { STAGEHAND_RUNTIME_VERSION } from "../version.ts";

describe("runtime descriptor", () => {
  it("publishes a valid runtime descriptor", () => {
    const scope: StagehandServiceWorkerScope = {};
    startStagehandServiceWorker(scope);

    expect(
      RuntimeDescriptorSchema.parse({
        protocolVersion: scope.__stagehand_runtime?.protocolVersion,
        serverInfo: scope.__stagehand_runtime?.serverInfo,
      }),
    ).toStrictEqual({
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      serverInfo: { name: "stagehand", version: extensionPackageJson.version },
    });
    expect(scope.__stagehand_runtime).toMatchObject({
      state: "unconfigured",
      connected: false,
      timings: {},
    });
  });

  it("matches the extension package version", () => {
    expect(STAGEHAND_RUNTIME_VERSION).toBe(extensionPackageJson.version);
  });

  it("rejects unknown descriptor fields", () => {
    const descriptor = {
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      serverInfo: {
        name: "stagehand",
        version: extensionPackageJson.version,
      },
      status: "ready",
    };

    expect(() => RuntimeDescriptorSchema.parse(descriptor)).toThrow();
  });
});
