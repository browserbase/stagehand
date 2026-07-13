import { createBrowserController } from "./controllers/browserController.js";
import { createContextController } from "./controllers/contextController.js";
import { createLocatorController } from "./controllers/locatorController.js";
import { createPageController } from "./controllers/pageController.js";
import { createRuntimeController } from "./controllers/runtimeController.js";
import { createStagehandController } from "./controllers/stagehandController.js";
import { createStagehandRouter, type StagehandHandlers } from "./rpc/router.js";
import {
  createStagehandRuntimeService,
  type StagehandRuntimeDependencies,
} from "./services/stagehandRuntimeService.js";
import { browserLoopbackCdpFactory } from "./transports/browserLoopbackCdpConnection.js";

export type StagehandAppDependencies = StagehandRuntimeDependencies;

export function createStagehandApp(dependencies: StagehandAppDependencies = {}) {
  const service = createStagehandRuntimeService({
    ...dependencies,
    loopbackCdpFactory: dependencies.loopbackCdpFactory ?? browserLoopbackCdpFactory,
  });
  const runtime = createRuntimeController({ service });
  const browser = createBrowserController({ service });
  const stagehand = createStagehandController({ service });
  const context = createContextController({ service });
  const page = createPageController({ service });
  const locator = createLocatorController();

  const routes = {
    ping: runtime.ping,
    "runtime.configure": runtime.configure,
    "runtime.loopback_status": runtime.loopbackStatus,
    "browser.get_version": browser.getVersion,
    "stagehand.init": stagehand.init,
    "stagehand.close": stagehand.close,
    "stagehand.act": stagehand.act,
    "stagehand.observe": stagehand.observe,
    "stagehand.extract": stagehand.extract,
    "stagehand.metrics": stagehand.metrics,
    "context.pages": context.pages,
    "context.new_page": context.newPage,
    "page.goto": page.goto,
    "page.url": page.url,
    "page.title": page.title,
    "page.close": page.close,
    "locator.click": locator.click,
    "locator.fill": locator.fill,
    "locator.is_visible": locator.isVisible,
    "locator.text_content": locator.textContent,
  } satisfies StagehandHandlers;

  return {
    handle: createStagehandRouter(routes),
  };
}
