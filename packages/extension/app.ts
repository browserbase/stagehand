import { createBrowserController } from "./controllers/browserController.js";
import { createContextController } from "./controllers/contextController.js";
import { createLocatorController } from "./controllers/locatorController.js";
import { createPageController } from "./controllers/pageController.js";
import { createRuntimeController } from "./controllers/runtimeController.js";
import { createStagehandController } from "./controllers/stagehandController.js";
import { createStagehandRouter, type StagehandHandlers } from "./rpc/router.js";
import type { StagehandRuntime } from "./runtime.js";

export function createStagehandApp(runtime: StagehandRuntime) {
  const runtimeController = createRuntimeController(runtime);
  const browser = createBrowserController(runtime);
  const stagehand = createStagehandController(runtime);
  const context = createContextController(runtime);
  const page = createPageController(runtime);
  const locator = createLocatorController(runtime);

  const routes = {
    ping: runtimeController.ping,
    "runtime.configure": runtimeController.configure,
    "runtime.loopback_status": runtimeController.loopbackStatus,
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
    handle: createStagehandRouter(routes, runtime),
  };
}
