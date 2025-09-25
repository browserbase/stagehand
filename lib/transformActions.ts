interface Action {
  type: string;
  instruction?: string;
  action?: string;
  schema?: string;
}

/**
 * Transforms an array of actions into a TypeScript Stagehand script
 * @param actions Array of actions from agent execution
 * @returns Generated TypeScript script as a string
 */
export function transformActions(actions: Action[]): string {
  const lines = [
    `import { Stagehand } from "@browserbasehq/stagehand";`,
    `import { z } from "zod";`,
    ``,
    `async function runWorkflow() {`,
    `  const stagehand = new Stagehand();`,
    `  await stagehand.init();`,
    ``,
  ];

  let counter = 0;

  for (const action of actions) {
    switch (action.type) {
      case "extract":
        lines.push(
          `  const data${++counter} = await stagehand.extract({`,
          `    instruction: "${escapeString(action.instruction)}",`,
          `    schema: ${action.schema}`,
          `  });`,
          `  console.log("Extracted:", data${counter});`,
          ``,
        );
        break;

      case "act":
        lines.push(
          `  await stagehand.act({ action: "${escapeString(action.action)}" });`,
          ``,
        );
        break;

      case "observe":
        lines.push(
          `  const observation${++counter} = await stagehand.observe({`,
          `    instruction: "${escapeString(action.instruction)}"`,
          `  });`,
          `  console.log("Observed:", observation${counter});`,
          ``,
        );
        break;
    }
  }

  lines.push(`  await stagehand.close();`, `}`, ``, `runWorkflow();`);

  return lines.join("\n");
}

/**
 * Escapes special characters in strings for TypeScript code generation
 */
function escapeString(str: string): string {
  if (typeof str !== "string") return String(str);

  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}
