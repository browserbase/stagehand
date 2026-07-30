import { describe, expect, it } from "vitest";
import { RuntimeDescriptorSchema, STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.ts";
import serverPackageJson from "../package.json" with { type: "json" };
import {
  startStagehandServiceWorker,
  type StagehandServiceWorkerScope,
} from "../service-worker.ts";
import { STAGEHAND_RUNTIME_VERSION } from "../version.ts";

describe("runtime descriptor", () => {
  it("publishes a valid runtime descriptor", () => {
    const scope: StagehandServiceWorkerScope = {};
    startStagehandServiceWorker(scope);

    const descriptor = RuntimeDescriptorSchema.parse({
      protocolVersion: scope.__stagehand_runtime?.protocolVersion,
      serverInfo: scope.__stagehand_runtime?.serverInfo,
    });
    expect(descriptor).toStrictEqual({
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      serverInfo: {
        name: "stagehand",
        version: serverPackageJson.version,
      },
    });
    expect(scope.__stagehand_runtime).toMatchObject({
      name: "stagehand",
      version: STAGEHAND_RUNTIME_VERSION,
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      serverInfo: {
        name: "stagehand",
        version: serverPackageJson.version,
      },
      state: "unconfigured",
      connected: false,
      timings: {},
    });
  });

  it("matches the server package version", () => {
    expect(STAGEHAND_RUNTIME_VERSION).toBe(serverPackageJson.version);
  });

  it("rejects unknown descriptor fields", () => {
    const descriptor = {
      protocolVersion: 1,
      serverInfo: {
        name: "stagehand",
        version: serverPackageJson.version,
      },
      status: "ready",
    };

    expect(() => RuntimeDescriptorSchema.parse(descriptor)).toThrow();
  });
});
