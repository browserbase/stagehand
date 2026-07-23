import type {
  LocatorClickParams,
  LocatorDescriptor,
  LocatorFillParams,
  LocatorHighlightParams,
  LocatorScrollToParams,
  LocatorSelectOptionParams,
  LocatorSendClickEventParams,
  LocatorTypeParams,
} from "../../protocol/types.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createLocatorController(runtime: StagehandRuntime) {
  async function click(params: LocatorClickParams, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.click", {});
    return runtime.locatorClick(params);
  }

  async function fill(params: LocatorFillParams, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.fill", {});
    return runtime.locatorFill(params);
  }

  async function hover(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.hover", {});
    return runtime.locatorHover(params);
  }

  async function count(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.count", {});
    return runtime.locatorCount(params);
  }

  async function isChecked(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.is_checked", {});
    return runtime.locatorIsChecked(params);
  }

  async function inputValue(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.input_value", {});
    return runtime.locatorInputValue(params);
  }

  async function isVisible(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.is_visible", {});
    return runtime.locatorIsVisible(params);
  }

  async function innerText(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.inner_text", {});
    return runtime.locatorInnerText(params);
  }

  async function innerHtml(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.inner_html", {});
    return runtime.locatorInnerHtml(params);
  }

  async function textContent(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.text_content", {});
    return runtime.locatorTextContent(params);
  }

  async function scrollTo(params: LocatorScrollToParams, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.scroll_to", {});
    return runtime.locatorScrollTo(params);
  }

  async function centroid(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.centroid", {});
    return runtime.locatorCentroid(params);
  }

  async function highlight(params: LocatorHighlightParams, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.highlight", {});
    return runtime.locatorHighlight(params);
  }

  async function sendClickEvent(params: LocatorSendClickEventParams, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.send_click_event", {});
    return runtime.locatorSendClickEvent(params);
  }

  async function type(params: LocatorTypeParams, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.type", {});
    return runtime.locatorType(params);
  }

  async function selectOption(params: LocatorSelectOptionParams, { logger }: HandlerContext) {
    logger.info("[stagehand] locator.select_option", {});
    return runtime.locatorSelectOption(params);
  }

  return {
    click,
    fill,
    hover,
    count,
    isChecked,
    inputValue,
    isVisible,
    innerText,
    innerHtml,
    textContent,
    scrollTo,
    centroid,
    highlight,
    sendClickEvent,
    type,
    selectOption,
  };
}
