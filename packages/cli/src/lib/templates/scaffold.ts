import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { fail } from "../errors.js";
import type { Template, TemplateLanguage } from "./api.js";

interface ScaffolderCommand {
  argsPrefix: string[];
  command: string;
}

interface CommandResult {
  stderr: string;
  stdout: string;
}

export interface CloneTemplateOptions {
  destination?: string;
  language?: TemplateLanguage;
  quiet?: boolean;
  template: Template;
}

export interface CloneTemplateResult {
  destination: string;
  displayPath: string;
  language: TemplateLanguage;
  nextSteps: string[];
}

export function resolveTemplateLanguage(
  template: Template,
  language?: TemplateLanguage,
): TemplateLanguage {
  if (language) {
    if (!templateSupportsLanguage(template, language)) {
      fail(`Template "${template.slug}" does not support ${language}.`);
    }
    return language;
  }

  if (templateSupportsLanguage(template, "typescript")) {
    return "typescript";
  }

  if (templateSupportsLanguage(template, "python")) {
    return "python";
  }

  fail(
    `Template "${template.slug}" does not include TypeScript or Python scaffolding commands.`,
  );
}

export async function cloneTemplate(
  options: CloneTemplateOptions,
): Promise<CloneTemplateResult> {
  const language = resolveTemplateLanguage(options.template, options.language);
  const dest = resolve(options.destination ?? options.template.slug);
  const displayPath = options.destination ?? options.template.slug;

  if (existsSync(dest)) {
    fail(`Destination already exists: ${dest}`);
  }

  const parentDir = dirname(dest);
  const projectName = basename(dest);
  const scaffolder = getScaffolder(language);
  await mkdir(parentDir, { recursive: true });
  const existingEntries = await getDirectoryEntryNames(parentDir);

  if (!options.quiet) {
    console.log(
      `Scaffolding ${language}/${options.template.slug} into ${dest}...`,
    );
  }

  try {
    runCommand(
      scaffolder.command,
      [
        ...scaffolder.argsPrefix,
        projectName,
        "--template",
        options.template.slug,
      ],
      parentDir,
    );

    const createdDir = await findCreatedProjectDir(
      parentDir,
      existingEntries,
      projectName,
    );
    if (!createdDir) {
      throw new Error(
        `Scaffolder did not create a project directory in ${parentDir}.`,
      );
    }

    if (createdDir !== dest) {
      await rename(createdDir, dest);
    }
  } catch (error) {
    try {
      const createdDir = await findCreatedProjectDir(
        parentDir,
        existingEntries,
        projectName,
      );
      if (createdDir) {
        await rm(createdDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup failures and surface the original scaffolder error.
    }
    fail(`Failed to scaffold template: ${(error as Error).message}`);
  }

  return {
    destination: dest,
    displayPath,
    language,
    nextSteps: await buildNextSteps(dest, displayPath, language),
  };
}

function templateSupportsLanguage(
  template: Template,
  language: TemplateLanguage,
): boolean {
  const tags = new Set(template.tags.map((tag) => tag.toLowerCase()));
  const commands = template.commands.join("\n").toLowerCase();

  if (language === "typescript") {
    return (
      tags.has("typescript") || commands.includes("npx create-browser-app")
    );
  }

  return (
    tags.has("python") ||
    commands.includes("uvx create-browser-app") ||
    commands.includes("uv tool run create-browser-app")
  );
}

function commandExists(
  command: string,
  args: string[] = ["--version"],
): boolean {
  const result = spawnSync(command, args, {
    stdio: "ignore",
  });

  return !result.error && result.status === 0;
}

function getScaffolder(language: TemplateLanguage): ScaffolderCommand {
  if (language === "typescript") {
    if (commandExists("npx")) {
      return {
        command: "npx",
        argsPrefix: ["create-browser-app@latest"],
      };
    }

    if (commandExists("npm")) {
      return {
        command: "npm",
        argsPrefix: ["exec", "--yes", "create-browser-app@latest", "--"],
      };
    }

    fail(
      "TypeScript templates require `npx` or `npm` to scaffold a ready-to-run project.",
    );
  }

  if (commandExists("uvx")) {
    return {
      command: "uvx",
      argsPrefix: ["create-browser-app"],
    };
  }

  if (commandExists("uv")) {
    return {
      command: "uv",
      argsPrefix: ["tool", "run", "create-browser-app"],
    };
  }

  fail(
    "Python templates require `uvx` or `uv` to scaffold a ready-to-run project.",
  );
}

function runCommand(
  command: string,
  args: string[],
  cwd?: string,
): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr =
      typeof result.stderr === "string" ? result.stderr.trim() : "";
    const stdout =
      typeof result.stdout === "string" ? result.stdout.trim() : "";
    const renderedCommand = `${command} ${args.join(" ")}`;
    throw new Error(
      stderr ||
        stdout ||
        `${renderedCommand} failed with exit code ${result.status ?? "unknown"}.`,
    );
  }

  return {
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
}

async function getDirectoryEntryNames(pathname: string): Promise<Set<string>> {
  const entries = await readdir(pathname, { withFileTypes: true });
  return new Set(entries.map((entry) => entry.name));
}

async function findCreatedProjectDir(
  parentDir: string,
  existingEntries: Set<string>,
  requestedName: string,
): Promise<string | null> {
  const exactDir = join(parentDir, requestedName);
  if (existsSync(exactDir)) {
    return exactDir;
  }

  const entries = await readdir(parentDir, { withFileTypes: true });
  const newDirs = entries.filter(
    (entry) => entry.isDirectory() && !existingEntries.has(entry.name),
  );
  if (newDirs.length === 1) {
    return join(parentDir, newDirs[0]!.name);
  }

  return null;
}

async function buildNextSteps(
  dest: string,
  displayPath: string,
  language: TemplateLanguage,
): Promise<string[]> {
  const nextSteps = [`cd ${displayPath}`];

  if (language === "typescript") {
    if (existsSync(join(dest, "package.json"))) {
      nextSteps.push("npm install");
    }

    if (existsSync(join(dest, ".env.example"))) {
      nextSteps.push("cp .env.example .env");
    }

    const packageJson = await readPackageJson(dest);
    if (packageJson?.scripts?.dev) {
      nextSteps.push("npm run dev");
      return nextSteps;
    }

    if (packageJson?.scripts?.start) {
      nextSteps.push("npm start");
      return nextSteps;
    }

    if (existsSync(join(dest, "index.ts"))) {
      nextSteps.push("npx tsx index.ts");
    }

    return nextSteps;
  }

  if (existsSync(join(dest, "pyproject.toml"))) {
    nextSteps.push("uv sync");
  } else if (existsSync(join(dest, "requirements.txt"))) {
    nextSteps.push("pip install -r requirements.txt");
  }

  if (existsSync(join(dest, ".env.example"))) {
    nextSteps.push("cp .env.example .env");
  }

  if (existsSync(join(dest, "main.py"))) {
    nextSteps.push("python main.py");
  }

  return nextSteps;
}

async function readPackageJson(
  dest: string,
): Promise<{ scripts?: Record<string, string> } | null> {
  const packageJsonPath = join(dest, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const contents = await readFile(packageJsonPath, "utf8");
    return JSON.parse(contents) as { scripts?: Record<string, string> };
  } catch {
    return null;
  }
}
