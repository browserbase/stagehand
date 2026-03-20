import type { FastifyPluginCallback, RouteOptions } from "fastify";

import addInitScriptRoute from "./addInitScript.js";
import pageActionDetailsRoute from "./action/_actionId.js";
import pageActionListRoute from "./action/index.js";
import clickRoute from "./click.js";
import closeRoute from "./close.js";
import dragAndDropRoute from "./dragAndDrop.js";
import enableCursorOverlayRoute from "./enableCursorOverlay.js";
import evaluateRoute from "./evaluate.js";
import framesRoute from "./frames.js";
import getFullFrameTreeRoute from "./getFullFrameTree.js";
import goBackRoute from "./goBack.js";
import goForwardRoute from "./goForward.js";
import gotoRoute from "./goto.js";
import hoverRoute from "./hover.js";
import keyPressRoute from "./keyPress.js";
import listAllFrameIdsRoute from "./listAllFrameIds.js";
import mainFrameIdRoute from "./mainFrameId.js";
import screenshotRoute from "./screenshot.js";
import scrollRoute from "./scroll.js";
import sendCDPRoute from "./sendCDP.js";
import setExtraHTTPHeadersRoute from "./setExtraHTTPHeaders.js";
import setViewportSizeRoute from "./setViewportSize.js";
import snapshotRoute from "./snapshot.js";
import targetIdRoute from "./targetId.js";
import titleRoute from "./title.js";
import typeRoute from "./type.js";
import urlRoute from "./url.js";
import waitForLoadStateRoute from "./waitForLoadState.js";
import waitForSelectorRoute from "./waitForSelector.js";
import waitForTimeoutRoute from "./waitForTimeout.js";
import reloadRoute from "./reload.js";
import { buildErrorResponse } from "../../../schemas/v4/page.js";
import { normalizePluginError, withTag } from "../pluginUtils.js";

const rawPageRoutes: RouteOptions[] = [
  clickRoute,
  hoverRoute,
  scrollRoute,
  dragAndDropRoute,
  typeRoute,
  keyPressRoute,
  gotoRoute,
  reloadRoute,
  goBackRoute,
  goForwardRoute,
  closeRoute,
  enableCursorOverlayRoute,
  addInitScriptRoute,
  targetIdRoute,
  mainFrameIdRoute,
  getFullFrameTreeRoute,
  listAllFrameIdsRoute,
  titleRoute,
  urlRoute,
  framesRoute,
  setExtraHTTPHeadersRoute,
  screenshotRoute,
  snapshotRoute,
  setViewportSizeRoute,
  waitForLoadStateRoute,
  waitForSelectorRoute,
  waitForTimeoutRoute,
  evaluateRoute,
  sendCDPRoute,
  pageActionListRoute,
  pageActionDetailsRoute,
];

export const pageRoutes: RouteOptions[] = rawPageRoutes.map((route) =>
  withTag(route, "page"),
);

export const pageRoutesPlugin: FastifyPluginCallback = (
  instance,
  _opts,
  done,
) => {
  instance.setErrorHandler((error, _request, reply) => {
    const { errorMessage, stack, statusCode } = normalizePluginError(error);

    return reply.status(statusCode).send(
      buildErrorResponse({
        error: errorMessage,
        statusCode,
        stack,
      }),
    );
  });

  for (const route of pageRoutes) {
    instance.route(route);
  }

  done();
};
