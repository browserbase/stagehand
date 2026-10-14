import { browserbase, type Stagehand, type StagehandBrowser } from "@browserbasehq/stagehand";
import { afterEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  apiKey: undefined as string | undefined,
  proxies: undefined as boolean | undefined,
  sessionTimeoutSeconds: 900,
}));

vi.mock("../extension/extension.js", () => ({ default: { config } }));

import {
  createStagehandResourceFactory,
  StagehandSessionInitializationError,
} from "../extension/lib/session.js";

afterEach(() => {
  config.apiKey = undefined;
  config.proxies = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("browser credentials", () => {
  it("resolves the environment at execution and gives explicit configuration precedence", async () => {
    vi.stubEnv("BROWSERBASE_API_KEY", undefined);
    const launch = vi
      .spyOn(browserbase, "launch")
      .mockResolvedValue({ closed: false } as StagehandBrowser);
    const create = createStagehandResourceFactory(undefined, async () => ({}) as Stagehand);
    expect(launch).not.toHaveBeenCalled();

    vi.stubEnv("BROWSERBASE_API_KEY", "test-runtime-key");
    await create();
    expect(launch).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: "test-runtime-key" }),
    );

    config.apiKey = "test-configured-key";
    await create();
    expect(launch).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: "test-configured-key" }),
    );
  });

  it("fails before launching when no credential is configured", async () => {
    vi.stubEnv("BROWSERBASE_API_KEY", undefined);
    const launch = vi.spyOn(browserbase, "launch");
    await expect(createStagehandResourceFactory()()).rejects.toBeInstanceOf(
      StagehandSessionInitializationError,
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it("preserves Browserbase proxy defaults and forwards explicit overrides", async () => {
    vi.stubEnv("BROWSERBASE_API_KEY", "test-runtime-key");
    const launch = vi
      .spyOn(browserbase, "launch")
      .mockResolvedValue({ closed: false } as StagehandBrowser);
    const create = createStagehandResourceFactory(undefined, async () => ({}) as Stagehand);

    await create();
    expect(launch.mock.calls.at(-1)?.[0]).not.toHaveProperty("proxies");

    for (const proxies of [true, false]) {
      config.proxies = proxies;
      await create();
      expect(launch).toHaveBeenLastCalledWith(expect.objectContaining({ proxies }));
    }
  });
});
