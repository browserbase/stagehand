import type {
  LocatorClickParams,
  LocatorDescriptor,
  LocatorFillParams,
} from "../../protocol/types.js";
import { StagehandRuntimeError } from "../services/stagehandRuntimeService.js";

export function createLocatorController() {
  async function click(_params: LocatorClickParams): Promise<never> {
    console.log("[stagehand] locator.click");
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
  }

  async function fill(_params: LocatorFillParams): Promise<never> {
    console.log("[stagehand] locator.fill");
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
  }

  async function isVisible(_params: LocatorDescriptor): Promise<never> {
    console.log("[stagehand] locator.is_visible");
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
  }

  async function textContent(_params: LocatorDescriptor): Promise<never> {
    console.log("[stagehand] locator.text_content");
    throw new StagehandRuntimeError(
      "Method not implemented by the smoke runtime",
      -32601,
      "stagehand.unknown_command",
    );
  }

  return {
    click,
    fill,
    isVisible,
    textContent,
  };
}
