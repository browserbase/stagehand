import { describe, expect, it } from "vitest";
import { stagehandFacadeConfigFromEnv } from "@browserbasehq/stagehand-integrations/facade";
import {
  evalBooleanEnv,
  evalBrowserbaseSessionOptions,
  evalBrowserbaseSessionTimeoutSeconds,
} from "../../core/targets/browserbaseSessionOptions.js";
import { browserSessionLostCause } from "../../core/tools/browserSessionLoss.js";

// Browserbase API contract: https://docs.browserbase.com/reference/api/create-a-session
// Package parsers stay independent; this test prevents their public ranges drifting.
describe("Browserbase session settings", () => {
  it.each([undefined, "60", "3600", "21600"])(
    "agrees with facade timeout validation for %s",
    (raw) => {
      const facade = stagehandFacadeConfigFromEnv({
        BROWSERBASE_API_KEY: "test",
        STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS: raw,
      });
      expect(facade.browser.launchOptions).toMatchObject({
        timeout: evalBrowserbaseSessionTimeoutSeconds(raw),
      });
    },
  );
  it.each(["0", "59", "21601", "NaN", "60.5", "-1", "9007199254740992"])(
    "rejects invalid timeout %s in both packages",
    (raw) => {
      expect(() => evalBrowserbaseSessionTimeoutSeconds(raw)).toThrow();
      expect(() =>
        stagehandFacadeConfigFromEnv({
          BROWSERBASE_API_KEY: "test",
          STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS: raw,
        }),
      ).toThrow();
    },
  );
  it.each(["1", "true", "yes", "on", " TRUE "])("accepts enabled boolean %s", (raw) =>
    expect(evalBooleanEnv(raw, false)).toBe(true),
  );
  it.each(["0", "false", "no", "off", " OFF "])("accepts disabled boolean %s", (raw) =>
    expect(evalBooleanEnv(raw, true)).toBe(false),
  );
  it("uses defaults and rejects unknown boolean values", () => {
    expect(evalBrowserbaseSessionOptions({})).toEqual({
      timeoutSeconds: 3600,
      proxies: true,
      verified: true,
    });
    expect(evalBooleanEnv(" ", false)).toBe(false);
    expect(() => evalBooleanEnv("maybe", true)).toThrow();
  });
  it("extracts multiline loss causes without the surrounding instruction", () => {
    expect(
      browserSessionLostCause(
        "Browser session lost (first\nsecond https://example.test?apiKey=secret123). Stop.",
      ),
    ).toBe("first\nsecond https://example.test?apiKey=[redacted]");
  });
});
