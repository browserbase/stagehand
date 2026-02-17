import { StatusCodes } from "http-status-codes";

import { AppError } from "../../../lib/errorHandler.js";
import type { V4BrowserRecord } from "../../types.js";
import { BaseBrowserService, type BrowserLaunchPayload } from "./BaseBrowserService.js";

export class BrowserbaseBrowserService extends BaseBrowserService {
  protected readonly browserMode: V4BrowserRecord["browserMode"] = "browserbase";

  protected async launchOrConnect(
    payload: BrowserLaunchPayload,
  ): Promise<{ browser: V4BrowserRecord }> {
    if (!payload.browserbaseApiKey || !payload.browserbaseProjectId) {
      throw new AppError(
        "browserbaseApiKey and browserbaseProjectId are required for browserbase mode",
        StatusCodes.BAD_REQUEST,
      );
    }

    const startResult = await this.deps.sessionStore.startSession({
      browserType: "browserbase",
      modelName: payload.modelName,
      connectUrl: payload.cdpUrl,
      browserbaseSessionID: payload.browserbaseSessionId,
      browserbaseApiKey: payload.browserbaseApiKey,
      browserbaseProjectId: payload.browserbaseProjectId,
      browserbaseSessionCreateParams: payload.browserbaseSessionCreateParams,
    });

    return this.finalizeLaunch(payload, startResult);
  }
}
