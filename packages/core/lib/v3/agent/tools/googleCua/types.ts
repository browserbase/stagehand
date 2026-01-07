/**
 * Shared types for Google CUA tools
 */

import type { ModelOutputContentItem } from "../../../types/public/agent";

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

