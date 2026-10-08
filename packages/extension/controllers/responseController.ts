import type { ResponseIdParams } from "@browserbasehq/stagehand-protocol/types";
import type { HandlerContext } from "../rpcRouter.js";
import type { StagehandRuntime } from "../runtime.js";

export function createResponseController(runtime: StagehandRuntime) {
  async function body(params: ResponseIdParams, { logger }: HandlerContext) {
    logger.debug("response.body", {});
    return runtime.responseBody(params);
  }

  async function allHeaders(params: ResponseIdParams, { logger }: HandlerContext) {
    logger.debug("response.all_headers", {});
    return runtime.responseAllHeaders(params);
  }

  async function headersArray(params: ResponseIdParams, { logger }: HandlerContext) {
    logger.debug("response.headers_array", {});
    return runtime.responseHeadersArray(params);
  }

  async function securityDetails(params: ResponseIdParams, { logger }: HandlerContext) {
    logger.debug("response.security_details", {});
    return runtime.responseSecurityDetails(params);
  }

  async function serverAddr(params: ResponseIdParams, { logger }: HandlerContext) {
    logger.debug("response.server_addr", {});
    return runtime.responseServerAddr(params);
  }

  async function finished(params: ResponseIdParams, { logger }: HandlerContext) {
    logger.debug("response.finished", {});
    return runtime.responseFinished(params);
  }

  return {
    body,
    allHeaders,
    headersArray,
    securityDetails,
    serverAddr,
    finished,
  };
}
