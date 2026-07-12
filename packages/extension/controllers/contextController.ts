import type { ContextNewPageParams, EmptyParams } from "../../protocol/types.js";
import type { StagehandRuntimeService } from "../services/stagehandRuntimeService.js";

type ContextService = Pick<StagehandRuntimeService, "contextNewPage" | "contextPages">;

export function createContextController({ service }: { service: ContextService }) {
  async function pages(_params: EmptyParams) {
    console.log("[stagehand] context.pages");
    return service.contextPages();
  }

  async function newPage(params: ContextNewPageParams) {
    console.log("[stagehand] context.new_page");
    return service.contextNewPage(params);
  }

  return {
    pages,
    newPage,
  };
}
