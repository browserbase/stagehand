import type { V4BrowserRecord } from "../../types.js";
import { BaseBrowserService, type BrowserLaunchPayload } from "./BaseBrowserService.js";

export class LocalBrowserService extends BaseBrowserService {
  protected readonly browserMode: V4BrowserRecord["browserMode"] = "local";

  protected async launchOrConnect(
    payload: BrowserLaunchPayload,
  ): Promise<{ browser: V4BrowserRecord }> {
    const startResult = await this.deps.sessionStore.startSession({
      browserType: "local",
      modelName: payload.modelName,
      connectUrl: payload.cdpUrl,
      localBrowserLaunchOptions: {
        cdpUrl: payload.cdpUrl,
        ...(payload.browserLaunchOptions ?? {}),
      } as any,
    });

    return this.finalizeLaunch(payload, startResult);
  }
}
