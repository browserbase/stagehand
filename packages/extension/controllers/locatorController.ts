import type {
  LocatorClickParams,
  LocatorDescriptor,
  LocatorFillParams,
} from "../../protocol/types.js";
import type { StagehandRuntimeService } from "../services/stagehandRuntimeService.js";

type LocatorService = Pick<
  StagehandRuntimeService,
  "locatorClick" | "locatorFill" | "locatorIsVisible" | "locatorTextContent"
>;

export function createLocatorController({ service }: { service: LocatorService }) {
  async function click(params: LocatorClickParams) {
    console.log("[stagehand] locator.click");
    return service.locatorClick(params);
  }

  async function fill(params: LocatorFillParams) {
    console.log("[stagehand] locator.fill");
    return service.locatorFill(params);
  }

  async function isVisible(params: LocatorDescriptor) {
    console.log("[stagehand] locator.is_visible");
    return service.locatorIsVisible(params);
  }

  async function textContent(params: LocatorDescriptor) {
    console.log("[stagehand] locator.text_content");
    return service.locatorTextContent(params);
  }

  return {
    click,
    fill,
    isVisible,
    textContent,
  };
}
