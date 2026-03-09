import type { RouteOptions } from "fastify";

import pageActionDetailsRoute from "./action/_actionId.js";
import pageActionListRoute from "./action/index.js";
import clickRoute from "./click.js";
import closeRoute from "./close.js";
import dragAndDropRoute from "./dragAndDrop.js";
import evaluateRoute from "./evaluate.js";
import goBackRoute from "./goBack.js";
import goForwardRoute from "./goForward.js";
import gotoRoute from "./goto.js";
import hoverRoute from "./hover.js";
import keyPressRoute from "./keyPress.js";
import reloadRoute from "./reload.js";
import screenshotRoute from "./screenshot.js";
import scrollRoute from "./scroll.js";
import sendCDPRoute from "./sendCDP.js";
import setViewportSizeRoute from "./setViewportSize.js";
import snapshotRoute from "./snapshot.js";
import titleRoute from "./title.js";
import typeRoute from "./type.js";
import urlRoute from "./url.js";
import waitForLoadStateRoute from "./waitForLoadState.js";
import waitForSelectorRoute from "./waitForSelector.js";
import waitForTimeoutRoute from "./waitForTimeout.js";

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
  titleRoute,
  urlRoute,
  screenshotRoute,
  snapshotRoute,
  setViewportSizeRoute,
  waitForLoadStateRoute,
  waitForSelectorRoute,
  waitForTimeoutRoute,
  evaluateRoute,
  sendCDPRoute,
  closeRoute,
  pageActionListRoute,
  pageActionDetailsRoute,
];
