import { StatusCodes } from "http-status-codes";

import { AppError } from "../../../lib/errorHandler.js";
import type { V4BrowserRecord } from "../../types.js";
import { BaseBrowserService, type BrowserLaunchPayload } from "./BaseBrowserService.js";

export class RemoteCdpBrowserService extends BaseBrowserService {
  protected readonly browserMode: V4BrowserRecord["browserMode"] = "remote";

  protected async launchOrConnect(
    payload: BrowserLaunchPayload,
  ): Promise<{ browser: V4BrowserRecord }> {
    if (!payload.cdpUrl) {
      throw new AppError(
        "cdpUrl is required for remote-cdp browser mode",
        StatusCodes.BAD_REQUEST,
      );
    }

    const startResult = await this.deps.sessionStore.startSession({
      browserType: "local",
      modelName: payload.modelName,
      connectUrl: payload.cdpUrl,
      localBrowserLaunchOptions: {
        cdpUrl: payload.cdpUrl,
      },
    });

    return this.finalizeLaunch(payload, startResult);
  }
}
