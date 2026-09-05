import type {
  LocatorClickParams,
  LocatorDescriptor,
  LocatorFillParams,
  LocatorHighlightParams,
  LocatorScrollToParams,
  LocatorSelectOptionParams,
  LocatorSetInputFilesParams,
  LocatorSendClickEventParams,
  LocatorTypeParams,
} from "@browserbasehq/stagehand-protocol/types";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createLocatorController(runtime: StagehandRuntime) {
  async function click(params: LocatorClickParams, { logger }: HandlerContext) {
    logger.debug("locator.click", {});
    return runtime.locatorClick(params);
  }

  async function fill(params: LocatorFillParams, { logger }: HandlerContext) {
    logger.debug("locator.fill", {});
    return runtime.locatorFill(params);
  }

  async function hover(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.debug("locator.hover", {});
    return runtime.locatorHover(params);
  }

  async function count(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.debug("locator.count", {});
    return runtime.locatorCount(params);
  }

  async function isChecked(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.debug("locator.is_checked", {});
    return runtime.locatorIsChecked(params);
  }

  async function inputValue(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.debug("locator.input_value", {});
    return runtime.locatorInputValue(params);
  }

  async function isVisible(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.debug("locator.is_visible", {});
    return runtime.locatorIsVisible(params);
  }

  async function innerText(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.debug("locator.inner_text", {});
    return runtime.locatorInnerText(params);
  }

  async function innerHtml(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.debug("locator.inner_html", {});
    return runtime.locatorInnerHtml(params);
  }

  async function textContent(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.debug("locator.text_content", {});
    return runtime.locatorTextContent(params);
  }

  async function scrollTo(params: LocatorScrollToParams, { logger }: HandlerContext) {
    logger.debug("locator.scroll_to", {});
    return runtime.locatorScrollTo(params);
  }

  async function centroid(params: LocatorDescriptor, { logger }: HandlerContext) {
    logger.debug("locator.centroid", {});
    return runtime.locatorCentroid(params);
  }

  async function highlight(params: LocatorHighlightParams, { logger }: HandlerContext) {
    logger.debug("locator.highlight", {});
    return runtime.locatorHighlight(params);
  }

  async function sendClickEvent(params: LocatorSendClickEventParams, { logger }: HandlerContext) {
    logger.debug("locator.send_click_event", {});
    return runtime.locatorSendClickEvent(params);
  }

  async function type(params: LocatorTypeParams, { logger }: HandlerContext) {
    logger.debug("locator.type", {});
    return runtime.locatorType(params);
  }

  async function selectOption(params: LocatorSelectOptionParams, { logger }: HandlerContext) {
    logger.debug("locator.select_option", {});
    return runtime.locatorSelectOption(params);
  }

  async function setInputFiles(params: LocatorSetInputFilesParams, { logger }: HandlerContext) {
    logger.debug("locator.set_input_files", { fileCount: params.files.length });
    return runtime.locatorSetInputFiles(params);
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
    setInputFiles,
  };
}
