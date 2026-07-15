import type {
  LocatorClickParams,
  LocatorCentroidParams,
  LocatorCountParams,
  LocatorDescriptor,
  LocatorFillParams,
  LocatorHighlightParams,
  LocatorHoverParams,
  LocatorInnerHtmlParams,
  LocatorInnerTextParams,
  LocatorInputValueParams,
  LocatorIsCheckedParams,
  LocatorScrollToParams,
  LocatorSelectOptionParams,
  LocatorSendClickEventParams,
  LocatorTypeParams,
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

  async function hover(params: LocatorHoverParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.hover", {});
    return runtime.locatorHover(params);
  }

  async function count(params: LocatorCountParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.count", {});
    return runtime.locatorCount(params);
  }

  async function isChecked(params: LocatorIsCheckedParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.is_checked", {});
    return runtime.locatorIsChecked(params);
  }

  async function inputValue(params: LocatorInputValueParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.input_value", {});
    return runtime.locatorInputValue(params);
  }

  async function isVisible(params: LocatorDescriptor, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.is_visible", {});
    return runtime.locatorIsVisible(params);
  }

  async function innerText(params: LocatorInnerTextParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.inner_text", {});
    return runtime.locatorInnerText(params);
  }

  async function innerHtml(params: LocatorInnerHtmlParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.inner_html", {});
    return runtime.locatorInnerHtml(params);
  }

  async function textContent(params: LocatorDescriptor, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.text_content", {});
    return runtime.locatorTextContent(params);
  }

  async function scrollTo(params: LocatorScrollToParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.scroll_to", {});
    return runtime.locatorScrollTo(params);
  }

  async function centroid(params: LocatorCentroidParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.centroid", {});
    return runtime.locatorCentroid(params);
  }

  async function highlight(params: LocatorHighlightParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.highlight", {});
    return runtime.locatorHighlight(params);
  }

  async function sendClickEvent(
    params: LocatorSendClickEventParams,
    { logger }: StagehandHandlerContext,
  ) {
    logger.info("[stagehand] locator.send_click_event", {});
    return runtime.locatorSendClickEvent(params);
  }

  async function type(params: LocatorTypeParams, { logger }: StagehandHandlerContext) {
    logger.info("[stagehand] locator.type", {});
    return runtime.locatorType(params);
  }

  async function selectOption(
    params: LocatorSelectOptionParams,
    { logger }: StagehandHandlerContext,
  ) {
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
