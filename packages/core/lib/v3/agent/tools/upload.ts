import path from "path";
import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { AgentModelConfig, Variables } from "../../types/public/agent.js";
import { substituteVariables } from "../utils/variables.js";
import { TimeoutError } from "../../types/public/sdkErrors.js";

const uploadInputInstruction = (target: string) =>
  `Find the actual <input type="file"> element for ${target}. Return the real upload input element itself, not a visible button, wrapper, label, or drag-and-drop container.`;

function summarizePaths(paths: string[]): string[] {
  return paths.map((filePath) => path.basename(filePath));
}

export const uploadTool = (
  v3: V3,
  executionModel?: string | AgentModelConfig,
  variables?: Variables,
  toolTimeout?: number,
) => {
  const hasVariables = variables && Object.keys(variables).length > 0;
  const availableVariables = hasVariables
    ? Object.keys(variables).join(", ")
    : "";

  return tool({
    description:
      "Upload one or more local files into a file input. Use this instead of clicking upload buttons when the user has provided a file path.",
    inputSchema: z.object({
      target: z
        .string()
        .describe(
          'Describe the actual file input target, e.g. "resume file input", "CV upload field", or "profile photo uploader".',
        ),
      paths: z
        .array(z.string().min(1))
        .min(1, "Provide at least one local file path to upload")
        .describe(
          hasVariables
            ? `One or more local file paths to upload. You may use %variableName% placeholders. Available variables: ${availableVariables}`
            : "One or more local file paths to upload.",
        ),
    }),
    execute: async ({ target, paths }) => {
      try {
        const resolvedPaths = paths.map((filePath) =>
          substituteVariables(filePath, variables).trim(),
        );
        const summarizedPaths = summarizePaths(resolvedPaths);

        v3.logger({
          category: "agent",
          message: "Agent calling tool: upload",
          level: 1,
          auxiliary: {
            target: {
              value: target,
              type: "string",
            },
            files: {
              value: JSON.stringify(summarizedPaths),
              type: "object",
            },
          },
        });

        const observeOptions = executionModel
          ? { model: executionModel, variables, timeout: toolTimeout }
          : { variables, timeout: toolTimeout };
        const matches = await v3.observe(
          uploadInputInstruction(target),
          observeOptions,
        );
        const fileInput = matches.find(
          (match) =>
            typeof match.selector === "string" &&
            match.selector !== "not-supported",
        );

        if (!fileInput?.selector) {
          return {
            success: false,
            error: `Could not find a file input for ${target}. Ask the agent to target the actual upload input field.`,
          };
        }

        const page = await v3.context.awaitActivePage();
        const uploadValue =
          resolvedPaths.length === 1 ? resolvedPaths[0]! : resolvedPaths;

        await page.deepLocator(fileInput.selector).setInputFiles(uploadValue);

        if (v3.isAgentReplayActive()) {
          v3.recordAgentReplayStep({
            type: "upload",
            target,
            selector: fileInput.selector,
            paths: resolvedPaths,
          });
        }

        return {
          success: true,
          target: fileInput.description || target,
          selector: fileInput.selector,
          files: summarizedPaths,
          fileCount: resolvedPaths.length,
        };
      } catch (error) {
        if (error instanceof TimeoutError) {
          throw error;
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
};
