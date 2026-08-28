import type {
  ContextAddCookiesParams,
  ContextAddInitScriptParams,
  ContextClearCookiesParams,
  ContextClipboardClearParams,
  ContextClipboardCopyParams,
  ContextClipboardCutParams,
  ContextClipboardPasteParams,
  ContextClipboardReadTextParams,
  ContextClipboardWriteTextParams,
  ContextCookiesParams,
  ContextNewPageParams,
  ContextSetActivePageParams,
  ContextSetDomainPolicyParams,
  ContextSetExtraHTTPHeadersParams,
  EmptyParams,
} from "../../protocol/types.js";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createContextController(runtime: StagehandRuntime) {
  async function pages(_params: EmptyParams, { logger }: HandlerContext) {
    logger.debug("context.pages", {});
    return runtime.contextPages();
  }

  async function newPage(params: ContextNewPageParams, { logger }: HandlerContext) {
    logger.debug("context.new_page", {});
    return runtime.contextNewPage(params);
  }

  async function activePage(_params: EmptyParams, { logger }: HandlerContext) {
    logger.debug("context.active_page", {});
    return runtime.contextActivePage();
  }

  async function setActivePage(params: ContextSetActivePageParams, { logger }: HandlerContext) {
    logger.debug("context.set_active_page", {});
    return runtime.contextSetActivePage(params);
  }

  async function addInitScript(params: ContextAddInitScriptParams, { logger }: HandlerContext) {
    logger.debug("context.add_init_script", {});
    return runtime.contextAddInitScript(params);
  }

  async function setExtraHTTPHeaders(
    params: ContextSetExtraHTTPHeadersParams,
    { logger }: HandlerContext,
  ) {
    logger.debug("context.set_extra_http_headers", {});
    return runtime.contextSetExtraHTTPHeaders(params);
  }

  async function getDomainPolicy(_params: EmptyParams, { logger }: HandlerContext) {
    logger.debug("context.get_domain_policy", {});
    return runtime.contextGetDomainPolicy();
  }

  async function setDomainPolicy(params: ContextSetDomainPolicyParams, { logger }: HandlerContext) {
    logger.debug("context.set_domain_policy", {});
    return runtime.contextSetDomainPolicy(params);
  }

  async function cookies(params: ContextCookiesParams, { logger }: HandlerContext) {
    logger.debug("context.cookies", {});
    return runtime.contextCookies(params);
  }

  async function addCookies(params: ContextAddCookiesParams, { logger }: HandlerContext) {
    logger.debug("context.add_cookies", {});
    return runtime.contextAddCookies(params);
  }

  async function clearCookies(params: ContextClearCookiesParams, { logger }: HandlerContext) {
    logger.debug("context.clear_cookies", {});
    return runtime.contextClearCookies(params);
  }

  async function clipboardReadText(
    params: ContextClipboardReadTextParams,
    { logger }: HandlerContext,
  ) {
    logger.debug("context.clipboard_read_text", {});
    return runtime.contextClipboardReadText(params);
  }

  async function clipboardWriteText(
    params: ContextClipboardWriteTextParams,
    { logger }: HandlerContext,
  ) {
    logger.debug("context.clipboard_write_text", {});
    return runtime.contextClipboardWriteText(params);
  }

  async function clipboardClear(params: ContextClipboardClearParams, { logger }: HandlerContext) {
    logger.debug("context.clipboard_clear", {});
    return runtime.contextClipboardClear(params);
  }

  async function clipboardPaste(params: ContextClipboardPasteParams, { logger }: HandlerContext) {
    logger.debug("context.clipboard_paste", {});
    return runtime.contextClipboardPaste(params);
  }

  async function clipboardCopy(params: ContextClipboardCopyParams, { logger }: HandlerContext) {
    logger.debug("context.clipboard_copy", {});
    return runtime.contextClipboardCopy(params);
  }

  async function clipboardCut(params: ContextClipboardCutParams, { logger }: HandlerContext) {
    logger.debug("context.clipboard_cut", {});
    return runtime.contextClipboardCut(params);
  }

  return {
    pages,
    newPage,
    activePage,
    setActivePage,
    addInitScript,
    setExtraHTTPHeaders,
    getDomainPolicy,
    setDomainPolicy,
    cookies,
    addCookies,
    clearCookies,
    clipboardReadText,
    clipboardWriteText,
    clipboardClear,
    clipboardPaste,
    clipboardCopy,
    clipboardCut,
  };
}
