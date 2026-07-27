import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RuntimeDescriptorSchema, STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.ts";
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
    expect(scope.__stagehand_runtime).toMatchObject({
      name: "stagehand",
      version: STAGEHAND_RUNTIME_VERSION,
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      serverInfo: {
        name: "stagehand",
        version: STAGEHAND_RUNTIME_VERSION,
      },
      state: "unconfigured",
      connected: false,
      timings: {},
    });
  });

  it("matches the server package version", () => {
    const serverPackage = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(STAGEHAND_RUNTIME_VERSION).toBe(serverPackage.version);
  });

  it("preserves unknown descriptor fields", () => {
    const descriptor = {
      protocolVersion: 1,
      serverInfo: {
        name: "stagehand",
        version: "4.0.0",
      },
      status: "ready",
    };

    expect(RuntimeDescriptorSchema.parse(descriptor)).toStrictEqual(descriptor);
  });
});
