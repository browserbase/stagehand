import type { CreateSessionParams } from "../../../lib/SessionStore.js";
import type { BrowserSession } from "../../../schemas/v4/browserSession.js";

export function buildBrowserSession(input: {
  id: string;
  params: CreateSessionParams;
  status: "running" | "ended";
  available: boolean;
  cdpUrl?: string | null;
}): BrowserSession {
  return {
    id: input.id,
    env: input.params.browserType === "local" ? "LOCAL" : "BROWSERBASE",
    status: input.status,
    modelName: input.params.modelName,
    cdpUrl: input.cdpUrl ?? input.params.connectUrl ?? "",
    available: input.available,
    browserbaseSessionId: input.params.browserbaseSessionID,
    browserbaseSessionCreateParams:
      input.params.browserbaseSessionCreateParams as BrowserSession["browserbaseSessionCreateParams"],
    localBrowserLaunchOptions: input.params.localBrowserLaunchOptions,
    domSettleTimeoutMs: input.params.domSettleTimeoutMs,
    verbose: input.params.verbose,
    systemPrompt: input.params.systemPrompt,
    selfHeal: input.params.selfHeal,
    waitForCaptchaSolves: input.params.waitForCaptchaSolves,
    experimental: input.params.experimental,
    actTimeoutMs: input.params.actTimeoutMs,
  };
}
