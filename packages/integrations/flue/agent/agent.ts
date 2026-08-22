"use agent";

import { useModel, useTool } from "@flue/runtime";

import { FACADE_AGENT_INSTRUCTIONS } from "@browserbasehq/stagehand-integrations/facade";

import runTool from "./tools/run.js";
import screenshotTool from "./tools/screenshot.js";
import snapshotTool from "./tools/snapshot.js";

export const FLUE_STAGEHAND_INSTRUCTIONS = `${FACADE_AGENT_INSTRUCTIONS}

The screenshot tool returns a temporary local file path and MIME type. Report that path so the user can inspect the image.`;

export function StagehandAgent() {
  useModel(process.env.FLUE_STAGEHAND_MODEL ?? "openai/gpt-5.6-luna");
  useTool(runTool);
  useTool(snapshotTool);
  useTool(screenshotTool);
  return FLUE_STAGEHAND_INSTRUCTIONS;
}
