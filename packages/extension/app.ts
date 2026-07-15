import { createBrowserController } from "./controllers/browserController.js";
import { createContextController } from "./controllers/contextController.js";
import { createLocatorController } from "./controllers/locatorController.js";
import { createPageController } from "./controllers/pageController.js";
import { createRuntimeController } from "./controllers/runtimeController.js";
import { createStagehandController } from "./controllers/stagehandController.js";
import { JSONRPCErrorCodes } from "../protocol/json-rpc/schemas.js";
import { createStagehandRouter, type StagehandHandlers } from "./rpc/router.js";
import { StagehandRuntimeError, type StagehandRuntime } from "./runtime.js";

async function unimplemented(): Promise<never> {
  throw new StagehandRuntimeError(
    "Method not implemented",
    JSONRPCErrorCodes.methodNotFound,
    "stagehand.unimplemented_command",
  );
}

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
    "locator.hover": unimplemented,
    "locator.count": unimplemented,
    "locator.is_checked": unimplemented,
    "locator.input_value": unimplemented,
    "locator.is_visible": locator.isVisible,
    "locator.inner_text": unimplemented,
    "locator.inner_html": unimplemented,
    "locator.text_content": locator.textContent,
    "locator.scroll_to": unimplemented,
    "locator.centroid": unimplemented,
    "locator.highlight": unimplemented,
    "locator.send_click_event": unimplemented,
    "locator.type": unimplemented,
    "locator.select_option": unimplemented,
  } satisfies StagehandHandlers;

  return {
    handle: createStagehandRouter(routes, runtime),
  };
}
