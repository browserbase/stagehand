import type { V3 } from "../../../v3.js";
import type { ModelOutputContentItem } from "../../../types/public/agent.js";
import { waitAndCaptureScreenshot } from "../../utils/screenshotHandler.js";

export { getConfiguredViewport } from "../../utils/coordinateNormalization.js";

export interface CuaToolResult {
  success: boolean;
  url?: string;
  error?: string;
  screenshotBase64?: string;
}

export type CuaModelOutput = {
  type: "content";
  value: ModelOutputContentItem[];
};

export async function createCuaResult(
  v3: V3,
  success: boolean,
  error?: string,
): Promise<CuaToolResult> {
  try {
    const page = await v3.context.awaitActivePage();
    const screenshotBase64 = await waitAndCaptureScreenshot(page);
    return {
      success,
      url: page.url(),
      error,
      screenshotBase64,
    };
  } catch (e) {
    return {
      success: false,
      error: error || (e as Error).message,
    };
  }
}

export function cuaToModelOutput(result: CuaToolResult): CuaModelOutput {
  const content: ModelOutputContentItem[] = [
    {
      type: "text",
      text: JSON.stringify({
        success: result.success,
        url: result.url,
        ...(result.error ? { error: result.error } : {}),
      }),
    },
  ];

  if (result.screenshotBase64) {
    content.push({
      type: "media",
      mediaType: "image/png",
      data: result.screenshotBase64,
    });
  }

  return { type: "content" as const, value: content };
}
