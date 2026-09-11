import { createFunctionProject } from "@browserbasehq/sdk-functions/core";

import { runFunctionsCore } from "./shared.js";

export interface InitFunctionsProjectOptions {
  packageManager: "npm" | "pnpm";
  projectName: string;
}

export async function initFunctionsProject({
  packageManager,
  projectName,
}: InitFunctionsProjectOptions): Promise<void> {
  const result = await runFunctionsCore(() =>
    createFunctionProject({
      packageManager,
      projectName,
      scripts: {
        deploy: "browse functions publish index.ts",
        dev: "browse functions dev index.ts",
      },
      onOutput(_stream, text) {
        // Keep stdout parseable for the command's final JSON result.
        process.stderr.write(text);
      },
    }),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        packageManager: result.packageManager,
        projectRoot: result.projectRoot,
        nextSteps: [
          `cd ${projectName}`,
          "Edit .env with your Browserbase API key",
          packageManager === "pnpm" ? "pnpm dev" : "npm run dev",
          packageManager === "pnpm" ? "pnpm run deploy" : "npm run deploy",
        ],
      },
      null,
      2,
    ),
  );
}
