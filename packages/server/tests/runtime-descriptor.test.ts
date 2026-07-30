import { describe, expect, it } from "vitest";
import { RuntimeDescriptorSchema } from "../../protocol/schemas.ts";
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

    expect(RuntimeDescriptorSchema.parse(scope.__stagehand_runtime)).toStrictEqual(
      scope.__stagehand_runtime,
    );
    expect(scope.__stagehand_runtime).toStrictEqual({
      protocolVersion: 1,
      serverInfo: {
        name: "stagehand",
        version: serverPackageJson.version,
      },
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
