import type { ToolSet } from "ai";
import type { EvalLogger } from "../logger.js";
import type {
  StagehandV4NativeRuntime,
  StagehandV4Page,
  StagehandV4ToolDefinition,
} from "./StagehandV4Types.js";

export type { StagehandV4ToolDefinition };

export type StagehandV4ToolCatalog = {
  definitions: StagehandV4ToolDefinition[];
  tools: ToolSet;
};

export async function createStagehandV4ToolCatalog(input: {
  client: StagehandV4NativeRuntime;
  definitions: StagehandV4ToolDefinition[];
  logger: EvalLogger;
}): Promise<StagehandV4ToolCatalog> {
  const { jsonSchema, tool } = await import("ai");
  const sdkDefinitions = input.definitions.filter((definition) => {
    const sdkMethodName =
      typeof definition.sdk_method_name === "string"
        ? definition.sdk_method_name
        : null;
    if (sdkMethodName == null) return false;
    const [objectName, snakeName] = sdkMethodName.split(".");
    return (
      (objectName === "browser" ||
        objectName === "page" ||
        objectName === "locator") &&
      typeof snakeName === "string" &&
      snakeName.length > 0
    );
  });
  return {
    definitions: sdkDefinitions,
    tools: buildStagehandV4ToolSet(
      sdkDefinitions,
      async (definition, args) => {
        return await callStagehandV4SdkTool(input.client, definition, args);
      },
      input.logger,
      { jsonSchema, tool },
    ),
  };
}

function buildStagehandV4ToolSet(
  catalog: StagehandV4ToolDefinition[],
  callTool: (
    definition: StagehandV4ToolDefinition,
    args: Record<string, unknown>,
  ) => Promise<unknown>,
  logger: EvalLogger,
  ai: Pick<typeof import("ai"), "jsonSchema" | "tool">,
): ToolSet {
  const tools: ToolSet = {};
  for (const definition of catalog) {
    const name = typeof definition.name === "string" ? definition.name : null;
    const rawSchema = definition.inputSchema ?? definition.parameters;
    const schema =
      rawSchema != null &&
      typeof rawSchema === "object" &&
      !Array.isArray(rawSchema)
        ? rawSchema
        : null;
    if (!name) continue;
    if (!schema) continue;
    tools[name] = ai.tool({
      description:
        typeof definition.description === "string"
          ? definition.description
          : name,
      inputSchema: ai.jsonSchema(schema),
      execute: async (args) => {
        logger.log({
          category: "understudy_v4_code",
          message: `Agent calling v4 tool: ${name}`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify(args),
              type: "object",
            },
          },
        });
        return toPlainToolResult(
          await callTool(definition, isRecord(args) ? args : {}),
        );
      },
    });
  }
  return tools;
}

function toPlainToolResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPlainToolResult);
  if (!isRecord(value)) return value;
  const toJSON = value.toJSON;
  if (typeof toJSON === "function") {
    return toPlainToolResult(toJSON.call(value));
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => typeof entry !== "function" && entry !== undefined)
      .map(([key, entry]) => [key, toPlainToolResult(entry)]),
  );
}

async function callStagehandV4SdkTool(
  client: StagehandV4NativeRuntime,
  definition: StagehandV4ToolDefinition,
  args: Record<string, unknown>,
): Promise<unknown> {
  const sdkMethodName =
    typeof definition.sdk_method_name === "string"
      ? definition.sdk_method_name
      : null;
  if (sdkMethodName == null) {
    throw new Error(
      `Tool "${String(definition.name)}" does not expose sdk_method_name.`,
    );
  }
  const [objectName, snakeName] = sdkMethodName.split(".");
  if (objectName == null || snakeName == null) {
    throw new Error(`Invalid SDK method name "${sdkMethodName}".`);
  }
  const methodName = snakeToCamel(snakeName);
  const target =
    objectName === "browser"
      ? client.browser
      : objectName === "page"
        ? await activeSdkPage(client, args)
        : objectName === "locator"
          ? await activeSdkLocator(client, args)
          : null;
  if (!isRecord(target)) {
    throw new Error(
      `Unsupported SDK object "${objectName}" for ${sdkMethodName}.`,
    );
  }
  const method = target[methodName];
  if (typeof method !== "function") {
    throw new Error(`Stagehand SDK does not expose ${sdkMethodName}.`);
  }
  return await method.call(target, args);
}

async function activeSdkPage(
  client: StagehandV4NativeRuntime,
  args: Record<string, unknown>,
): Promise<StagehandV4Page> {
  const locator = isRecord(args.locator) ? args.locator : {};
  const targetId =
    typeof locator.targetId === "string" ? locator.targetId : null;
  const pages = await client.browser.pages(
    targetId == null ? {} : { targetId },
  );
  if (targetId != null) {
    const page = pages[0];
    if (page != null) return page;
  }
  const page = pages.find((candidate) => !isInternalPage(candidate));
  if (page != null) return page;
  if (pages[0] != null) return pages[0];
  return await client.browser.newPage();
}

function isInternalPage(page: StagehandV4Page): boolean {
  return (
    page.url == null ||
    page.url === "about:blank" ||
    /^chrome(?:-[a-z]+)?:\/\//u.test(page.url)
  );
}

async function activeSdkLocator(
  client: StagehandV4NativeRuntime,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const page = await activeSdkPage(client, args);
  const locate = page.locate;
  if (typeof locate !== "function") {
    throw new Error("Stagehand SDK does not expose page.locate.");
  }
  const locator = isRecord(args.locator) ? args.locator : args;
  return (await locate.call(page, locator)) as Record<string, unknown>;
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
