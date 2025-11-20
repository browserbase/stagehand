import { describe, it } from "vitest";
import * as Stagehand from "../../dist/index.js";
import * as StagehandSDK from "../../../sdk/dist/index.js";

type AssertNever<T extends never> = T;

describe("Stagehand SDK API parity", () => {
  it("exposes at least the same top-level exports as core", () => {
    type CoreKeys = keyof typeof Stagehand;
    type SdkKeys = keyof typeof StagehandSDK;
    type MissingOnSdk = Exclude<CoreKeys, SdkKeys>;
    type IgnoredKeys =
      | "Page"
      | "PlaywrightPage"
      | "PatchrightPage"
      | "PuppeteerPage";
    type FilteredMissing = Exclude<MissingOnSdk, IgnoredKeys>;

    type _MissingOnSdk = AssertNever<FilteredMissing>;
    void (null as unknown as _MissingOnSdk);
  });

  it("mirrors the Stagehand.V3 method surface", () => {
    type CoreInstance = InstanceType<typeof Stagehand.V3>;
    type SdkInstance = InstanceType<typeof StagehandSDK.V3>;
    type MissingInstanceMethods = Exclude<
      keyof CoreInstance,
      keyof SdkInstance
    >;

    type _MissingInstanceMethods = AssertNever<MissingInstanceMethods>;
    void (null as unknown as _MissingInstanceMethods);
  });
});
