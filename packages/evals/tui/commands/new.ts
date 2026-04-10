/**
 * Scaffold command — generates a new task file with the right boilerplate.
 *
 * Usage: evals new core navigation my_task
 *        evals new bench act my_task
 */

import fs from "node:fs";
import path from "node:path";
import { green, red, dim, cyan } from "../format.js";
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

const BENCH_TEMPLATE = (name: string) => `import { EvalFunction } from "../../../types/evals.js";

export const ${name}: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
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
  } finally {
    await v3.close();
  }
};
`;

export function scaffoldTask(args: string[]): void {
  if (args.length < 3) {
    console.log(red("  Usage: new <tier> <category> <name>"));
    console.log(dim("  Example: new core navigation my_task"));
    return;
  }

  const [tier, category, name] = args;

  if (tier !== "core" && tier !== "bench") {
    console.log(red(`  Invalid tier "${tier}". Use "core" or "bench".`));
    return;
  }

  // Validate name
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    console.log(red(`  Invalid name "${name}". Use lowercase letters, numbers, underscores.`));
    return;
  }

  const packageRoot = getPackageRootDir();
  const taskDir =
    tier === "core"
      ? path.join(packageRoot, "core", "tasks", category)
      : path.join(packageRoot, "tasks", tier, category);
  const taskFile = path.join(taskDir, `${name}.ts`);

  if (fs.existsSync(taskFile)) {
    console.log(red(`  Task already exists: ${taskFile}`));
    return;
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
}
