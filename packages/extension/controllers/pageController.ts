import type { PageGotoParams, PageIdParams } from "../../protocol/types.js";
import type { StagehandRuntimeService } from "../services/stagehandRuntimeService.js";

type PageService = Pick<
  StagehandRuntimeService,
  "pageClose" | "pageGoto" | "pageTitle" | "pageUrl"
>;

export function createPageController({ service }: { service: PageService }) {
  async function goto(params: PageGotoParams) {
    console.log("[stagehand] page.goto");
    return service.pageGoto(params);
  }

  async function url(params: PageIdParams) {
    console.log("[stagehand] page.url");
    return service.pageUrl(params);
  }

  async function title(params: PageIdParams) {
    console.log("[stagehand] page.title");
    return service.pageTitle(params);
  }

  async function close(params: PageIdParams) {
    console.log("[stagehand] page.close");
    return service.pageClose(params);
  }

  return {
    goto,
    url,
    title,
    close,
  };
}
