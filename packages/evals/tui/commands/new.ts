/**
 * Scaffold command — generates a new task file with the right boilerplate.
 *
 * Usage: evals new core navigation my_task
 *        evals new bench act my_task
 */

import fs from "node:fs";
import path from "node:path";
import {
  bold,
  cyan,
  dim,
  green,
  gray,
  separator,
  red,
} from "../format.js";
import { getPackageRootDir } from "../../runtimePaths.js";

const CORE_TEMPLATE = (name: string) => `import { defineCoreTask } from "../../../framework/defineTask.js";

export default defineCoreTask(
  { name: "${name}" },
  async ({ page, assert, metrics }) => {
    await page.goto("https://example.com");

    const stop = metrics.startTimer("${name}_ms");
    // TODO: implement test logic
    stop();

    assert.truthy(true, "TODO: add assertions");
  },
);
`;

const BENCH_TEMPLATE = (
  name: string,
) => `import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "${name}" },
  async ({ v3, logger, debugUrl, sessionUrl }) => {
    try {
      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // TODO: implement eval logic

      return {
        _success: true,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } catch (error) {
      return {
        _success: false,
        error,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
`;

export type ScaffoldedTask = {
  tier: "core" | "bench";
  category: string;
  name: string;
  filePath: string;
  displayPath: string;
  content: string;
};

function getEditableComment(task: ScaffoldedTask): string {
  return task.tier === "core"
    ? "// TODO: implement test logic"
    : "// TODO: implement eval logic";
}

function getEditableStart(task: ScaffoldedTask): string {
  return 'await page.goto("https://example.com");';
}

function findEditableBounds(task: ScaffoldedTask): {
  startIndex: number;
  commentIndex: number;
} {
  const lines = task.content.split("\n");
  const startIndex = lines.findIndex((line) => line.includes(getEditableStart(task)));
  const commentIndex = lines.findIndex((line) => line.includes(getEditableComment(task)));

  if (startIndex === -1 || commentIndex === -1 || commentIndex < startIndex) {
    throw new Error(`Could not find editable block in ${task.displayPath}`);
  }

  return { startIndex, commentIndex };
}

export function scaffoldTask(args: string[]): ScaffoldedTask | null {
  if (args.length < 3) {
    console.log(red("  Usage: new <tier> <category> <name>"));
    console.log(dim("  Example: new core navigation my_task"));
    return null;
  }

  const [tier, category, name] = args;

  if (tier !== "core" && tier !== "bench") {
    console.log(red(`  Invalid tier "${tier}". Use "core" or "bench".`));
    return null;
  }

  // Validate name
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    console.log(red(`  Invalid name "${name}". Use lowercase letters, numbers, underscores.`));
    return null;
  }

  const packageRoot = getPackageRootDir();
  const taskDir =
    tier === "core"
      ? path.join(packageRoot, "core", "tasks", category)
      : path.join(packageRoot, "tasks", tier, category);
  const taskFile = path.join(taskDir, `${name}.ts`);

  if (fs.existsSync(taskFile)) {
    console.log(red(`  Task already exists: ${taskFile}`));
    return null;
  }

  fs.mkdirSync(taskDir, { recursive: true });

  const content = tier === "core" ? CORE_TEMPLATE(name) : BENCH_TEMPLATE(name);
  fs.writeFileSync(taskFile, content);

  const displayPath =
    tier === "core"
      ? `core/tasks/${category}/${name}.ts`
      : `tasks/${tier}/${category}/${name}.ts`;
  console.log(green(`  Created: `) + cyan(displayPath));
  console.log(dim("  Task will be auto-discovered on next run."));

  return {
    tier,
    category,
    name,
    filePath: taskFile,
    displayPath,
    content,
  };
}

export function formatScaffoldPreview(task: ScaffoldedTask): string {
  const lines = task.content.split("\n");
  const { startIndex, commentIndex } = findEditableBounds(task);
  let endIndex = commentIndex;
  for (let index = commentIndex + 1; index < lines.length; index += 1) {
    if (lines[index] === "") {
      break;
    }
    endIndex = index;
  }

  const numberedLines = lines
    .slice(startIndex, endIndex + 1)
    .map((line, index) => `${gray(String(index + 1).padStart(2, " "))} ${dim("│")} ${line.trimStart()}`);

  return [
    "",
    `  ${bold("Generated task:")} ${cyan(task.displayPath)}`,
    `  ${bold("Editable section:")}`,
    `  ${separator()}`,
    ...numberedLines.map((line) => `  ${line}`),
    `  ${separator()}`,
    `  ${dim("  Type lines to insert after the TODO comment. End with a single")} ${cyan(".")} ${dim("line to save, or")} ${cyan("/skip")} ${dim("to keep the scaffold.")}`,
  ].join("\n");
}

export function applyScaffoldEdit(
  task: ScaffoldedTask,
  insertedLines: string[],
): ScaffoldedTask {
  if (insertedLines.length === 0) {
    return task;
  }

  const lines = task.content.split("\n");
  const { commentIndex } = findEditableBounds(task);
  const indent = lines[commentIndex].match(/^\s*/)?.[0] ?? "";
  const normalizedLines = insertedLines.map((line) => {
    if (line.length === 0) return "";
    return /^\s/.test(line) ? line : `${indent}${line}`;
  });

  lines.splice(commentIndex + 1, 0, ...normalizedLines);
  const content = lines.join("\n");
  fs.writeFileSync(task.filePath, content);

  return {
    ...task,
    content,
  };
}
