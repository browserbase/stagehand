import type { EmptyParams } from "../../protocol/types.js";
import type { StagehandRuntimeService } from "../services/stagehandRuntimeService.js";

type BrowserService = Pick<StagehandRuntimeService, "browserGetVersion">;

export function createBrowserController({ service }: { service: BrowserService }) {
  async function getVersion(_params: EmptyParams) {
    console.log("[stagehand] browser.get_version");
    return service.browserGetVersion();
  }

  return {
    getVersion,
  };
}
