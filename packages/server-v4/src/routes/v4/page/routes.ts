import type { RouteOptions } from "fastify";

import addInitScriptRoute from "./addInitScript.js";
import asProtocolFrameTreeRoute from "./asProtocolFrameTree.js";
import pageActionDetailsRoute from "./action/_actionId.js";
import pageActionListRoute from "./action/index.js";
import clickRoute from "./click.js";
import closeRoute from "./close.js";
import dragAndDropRoute from "./dragAndDrop.js";
import enableCursorOverlayRoute from "./enableCursorOverlay.js";
import evaluateRoute from "./evaluate.js";
import framesRoute from "./frames.js";
import getFullFrameTreeRoute from "./getFullFrameTree.js";
import getOrdinalRoute from "./getOrdinal.js";
import goBackRoute from "./goBack.js";
import goForwardRoute from "./goForward.js";
import gotoRoute from "./goto.js";
import hoverRoute from "./hover.js";
import keyPressRoute from "./keyPress.js";
import listAllFrameIdsRoute from "./listAllFrameIds.js";
import mainFrameRoute from "./mainFrame.js";
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
import waitForMainLoadStateRoute from "./waitForMainLoadState.js";
import waitForSelectorRoute from "./waitForSelector.js";
import waitForTimeoutRoute from "./waitForTimeout.js";
import reloadRoute from "./reload.js";

export const pageRoutes: RouteOptions[] = [
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
  mainFrameRoute,
  getFullFrameTreeRoute,
  asProtocolFrameTreeRoute,
  listAllFrameIdsRoute,
  getOrdinalRoute,
  titleRoute,
  urlRoute,
  framesRoute,
  setExtraHTTPHeadersRoute,
  waitForMainLoadStateRoute,
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
