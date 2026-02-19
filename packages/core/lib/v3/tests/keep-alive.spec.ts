import { test } from "@playwright/test";
import {
  buildKeepAliveCases,
  getKeepAliveEnvConfig,
  runKeepAliveCase,
} from "./keep-alive.helpers.js";

test.describe.parallel("keepAlive behavior", () => {
  const { testEnv, apiKey, projectId, hasBrowserbaseCreds } =
    getKeepAliveEnvConfig();
  const cases = buildKeepAliveCases(testEnv);

  for (const testCase of cases) {
    test(testCase.title, async () => {
      if (testCase.requiresBrowserbase) {
        test.skip(!hasBrowserbaseCreds, "Browserbase credentials required");
      }

      await runKeepAliveCase(testCase, { apiKey, projectId });
    });
  }
});
