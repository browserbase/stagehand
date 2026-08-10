import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { EvalsError } from "../errors.js";
import type { TaskResult } from "./types.js";

export interface LoadedTaskDefinition {
  __taskDefinition: true;
  meta: unknown;
  fn: (ctx: unknown) => Promise<unknown>;
}

export type LegacyTaskFn = (ctx: unknown) => Promise<TaskResult>;

export interface LoadedTaskModule {
  definition?: LoadedTaskDefinition;
  legacyFn?: LegacyTaskFn;
}

export async function loadTaskModuleFromPath(
  filePath: string,
  taskName: string,
): Promise<LoadedTaskModule> {
  if (!fs.existsSync(filePath)) {
    throw new EvalsError(`Task module not found: ${filePath}`);
  }

  const moduleUrl = pathToFileURL(filePath).href;
  const taskModule = (await import(moduleUrl)) as Record<string, unknown>;

  const defaultExport = taskModule.default as
    | Partial<LoadedTaskDefinition>
    | undefined;
  if (defaultExport && defaultExport.__taskDefinition === true) {
    return { definition: defaultExport as LoadedTaskDefinition };
  }

  const baseName = taskName.includes("/")
    ? (taskName.split("/").pop() as string)
    : taskName;
  if (typeof taskModule[baseName] === "function") {
    return { legacyFn: taskModule[baseName] as LegacyTaskFn };
  }

  throw new EvalsError(
    `No task function found for "${taskName}" in ${filePath}. ` +
      `Expected either a default defineTask() export or a named export "${baseName}".`,
  );
}
