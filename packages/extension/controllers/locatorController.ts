import type {
  LocatorClickParams,
  LocatorDescriptor,
  LocatorFillParams,
} from "../../protocol/types.js";
import type { StagehandHandlerContext } from "../rpc/router.js";
import type { StagehandRuntime } from "../runtime.js";

export function createLocatorController(runtime: StagehandRuntime) {
  async function click(params: LocatorClickParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.click", {});
    return runtime.locatorClick(params);
  }

  async function fill(params: LocatorFillParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.fill", {});
    return runtime.locatorFill(params);
  }

  async function isVisible(params: LocatorDescriptor, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.is_visible", {});
    return runtime.locatorIsVisible(params);
  }

  async function textContent(params: LocatorDescriptor, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.text_content", {});
    return runtime.locatorTextContent(params);
  }

  return {
    click,
    fill,
    isVisible,
    textContent,
  };
}
