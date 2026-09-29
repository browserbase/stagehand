import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { fail } from "../errors.js";

const envTemplate = `# Browserbase Configuration
# Get your API key from https://browserbase.com/settings

BROWSERBASE_API_KEY=your_api_key_here
`;

const gitignoreTemplate = `node_modules/
.env
.env.local
dist/
.browserbase/
*.log
.DS_Store
`;

const starterFunctionTemplate = `import { defineFn } from "@browserbasehq/sdk-functions";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

defineFn(
  "my-function",
  async (context) => {
    const browser = await browserbase.connect({
      // The local dev server has no secrets, so fall back to .env.
      apiKey:
        context.secrets.BROWSERBASE_API_KEY ?? process.env.BROWSERBASE_API_KEY!,
      sessionId: context.session.id,
    });
    // In this example, Stagehand uses the Model Gateway where Browserbase charges for the tokens
    const stagehand = await Stagehand.create({ browser });
    const page = (await browser.context.activePage())!;

    await page.goto("https://news.ycombinator.com");
    const { data } = await stagehand.extract(
      "Extract the top 3 stories with their rank, title, and link URL.",
      z.object({
        stories: z
          .array(z.object({ rank: z.number(), title: z.string(), url: z.string() }))
          .max(3),
      }),
    );

    await stagehand.close();
    return {
      message: "Successfully fetched top Hacker News stories",
      timestamp: new Date().toISOString(),
      results: data.stories,
    };
  },
  {
    // Upload the Stagehand extension once, then paste its ID here:
    //   browse cloud extensions upload node_modules/@browserbasehq/stagehand/dist/assets/stagehand-extension.zip
    sessionConfig: { extensionId: "your-extension-id" },
  },
);
`;

// pnpm 11 and later fail installs when esbuild's build script is not approved. This file holds only that setting.
const pnpmWorkspaceTemplate = `allowBuilds:
  esbuild: true
`;

const tsconfigTemplate = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
`;

export interface InitFunctionsProjectOptions {
  packageManager: "npm" | "pnpm";
  projectName: string;
}

export async function initFunctionsProject({
  packageManager,
  projectName,
}: InitFunctionsProjectOptions): Promise<void> {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(projectName)) {
    fail(
      `Invalid project name "${projectName}". Use a leading letter, then letters, numbers, hyphens, or underscores.`,
    );
  }

  ensureCommand(packageManager);

  const projectRoot = resolve(projectName);
  if (existsSync(projectRoot)) {
    fail(`Directory already exists: ${projectRoot}`);
  }

  await mkdir(projectRoot, { recursive: true });

  const packageJson = {
    name: projectName,
    private: true,
    type: "module",
    scripts: {
      dev: "browse functions dev index.ts",
      deploy: "browse functions publish index.ts",
    },
  };

  await writeFile(
    join(projectRoot, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  await writeFile(join(projectRoot, ".env"), envTemplate);
  await writeFile(join(projectRoot, ".gitignore"), gitignoreTemplate);
  await writeFile(join(projectRoot, "index.ts"), starterFunctionTemplate);
  await writeFile(join(projectRoot, "tsconfig.json"), tsconfigTemplate);
  if (packageManager === "pnpm") {
    await writeFile(
      join(projectRoot, "pnpm-workspace.yaml"),
      pnpmWorkspaceTemplate,
    );
  }

  const install = packageManager === "pnpm" ? ["add"] : ["install"];
  const installDev =
    packageManager === "pnpm" ? ["add", "-D"] : ["install", "--save-dev"];

  runPackageManager(
    packageManager,
    [...install, "@browserbasehq/sdk-functions", "@browserbasehq/stagehand"],
    projectRoot,
  );
  // Two zod copies make schemas passed to Stagehand fail type checks, so match Stagehand's version.
  const zodVersion = readStagehandZodVersion(projectRoot);
  runPackageManager(
    packageManager,
    [...install, zodVersion ? `zod@${zodVersion}` : "zod"],
    projectRoot,
  );
  runPackageManager(
    packageManager,
    [...installDev, "typescript", "@types/node"],
    projectRoot,
  );

  if (!existsSync(join(projectRoot, ".git"))) {
    spawnSync("git", ["init"], {
      cwd: projectRoot,
      stdio: "ignore",
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        packageManager,
        projectRoot,
        nextSteps: [
          `cd ${projectName}`,
          "Edit .env with your Browserbase API key",
          "browse cloud extensions upload node_modules/@browserbasehq/stagehand/dist/assets/stagehand-extension.zip",
          "Paste the uploaded extension ID into index.ts",
          "browse functions dev index.ts",
          "browse functions publish index.ts",
          "Create a BROWSERBASE_API_KEY secret with browse cloud secrets create, then attach it with browse functions secrets attach",
        ],
      },
      null,
      2,
    ),
  );
}

function ensureCommand(command: string): void {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    fail(`${command} is required but was not found on PATH.`);
  }
}

function readStagehandZodVersion(projectRoot: string): string | undefined {
  try {
    const stagehandPackageJson = JSON.parse(
      readFileSync(
        join(
          projectRoot,
          "node_modules",
          "@browserbasehq",
          "stagehand",
          "package.json",
        ),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };
    return stagehandPackageJson.dependencies?.zod;
  } catch {
    return undefined;
  }
}

function runPackageManager(
  packageManager: "npm" | "pnpm",
  args: string[],
  cwd: string,
): void {
  const result = spawnSync(packageManager, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.stdout.length > 0) {
    process.stderr.write(result.stdout);
  }
  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }

  if (result.error || result.status !== 0) {
    fail(`Failed to install dependencies with ${packageManager}.`);
  }
}
