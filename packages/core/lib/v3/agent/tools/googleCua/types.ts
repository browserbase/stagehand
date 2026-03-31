import type { ModelOutputContentItem } from "../../../types/public/agent.js";

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
