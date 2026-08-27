import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
import { chromium } from "playwright-core";

defineFn("my-function", async (context) => {
  const browser = await chromium.connectOverCDP(context.session.connectUrl);
  const page = browser.contexts()[0]!.pages()[0]!;

  await page.goto("https://news.ycombinator.com");
  await page.waitForSelector(".athing", { timeout: 30_000 });

  const titles = await page.$$eval(".athing .titleline > a", (elements) =>
    elements.slice(0, 3).map((element) => element.textContent),
  );

  return {
    message: "Fetched top Hacker News titles",
    titles,
  };
});
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

  const install = packageManager === "pnpm" ? ["add"] : ["install"];
  const installDev =
    packageManager === "pnpm" ? ["add", "-D"] : ["install", "--save-dev"];

  runPackageManager(
    packageManager,
    [...install, "@browserbasehq/sdk-functions", "playwright-core"],
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
          packageManager === "pnpm" ? "pnpm dev" : "npm run dev",
          packageManager === "pnpm" ? "pnpm run deploy" : "npm run deploy",
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
