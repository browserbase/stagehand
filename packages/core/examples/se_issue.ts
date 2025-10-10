/**
 * Repro: trigger "selector engine has been already registered" *inside* Stagehand.
 *
 * Run: pnpm example
 */

import type { Stagehand as StagehandType } from "../lib/v3";
import StagehandConfig from "../stagehand.config";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

/** Typed shapes for dynamic import (no `any`). */
type StagehandCtor = new (options: typeof StagehandConfig) => StagehandType;
type StagehandModule = { Stagehand: StagehandCtor };

const req = createRequire(__filename);

/** Resolve the physical (real) directory of the installed Stagehand package. */
function resolveStagehandRoot(): string {
  const pkgJson = req.resolve("@browserbasehq/stagehand/package.json");
  const realPkgJson = fs.realpathSync(pkgJson);
  return path.dirname(realPkgJson);
}

/** Compute the entry file to import from a given Stagehand package folder. */
function resolveStagehandEntry(rootDir: string): string {
  const pkgPath = path.join(rootDir, "package.json");
  const pkgJson = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(pkgJson) as {
    main?: string;
    module?: string;
    exports?: unknown;
  };

  if (typeof pkg.module === "string") return path.join(rootDir, pkg.module);
  if (typeof pkg.main === "string") return path.join(rootDir, pkg.main);

  const fallback = path.join(rootDir, "dist", "index.js");
  if (fs.existsSync(fallback)) return fallback;

  throw new Error(
    `Could not determine Stagehand entry in ${rootDir} (no main/module and no dist/index.js).`,
  );
}

/**
 * Create an external copy of the Stagehand package in the OS temp dir and make its
 * node_modules a symlink back to the repo's node_modules so imports (esp. Playwright)
 * resolve to the same instance.
 */
function prepareExternalCopy(stagehandRoot: string): {
  copyRoot: string;
  entryFile: string;
} {
  const tempBase = path.join(os.tmpdir(), `stagehand-repro-${Date.now()}`);
  const copyRoot = path.join(tempBase, "stagehand-copy");

  fs.mkdirSync(tempBase, { recursive: true });

  // Copy source → temp, but skip heavy/irrelevant folders.
  fs.cpSync(stagehandRoot, copyRoot, {
    recursive: true,
    dereference: false,
    filter: (src: string): boolean => {
      const name = path.basename(src);
      // Skip these to keep the copy small and avoid recursion issues.
      if (name === "node_modules") return false;
      if (name === ".git" || name === ".turbo" || name === ".next")
        return false;
      return true;
    },
  });

  // Symlink node_modules in the copy to the original repo's node_modules.
  const origNodeModules = path.join(stagehandRoot, "node_modules");
  const copyNodeModules = path.join(copyRoot, "node_modules");

  try {
    fs.symlinkSync(
      origNodeModules,
      copyNodeModules,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch {
    // If symlink creation isn't permitted, fall back to copying node_modules.
    // (Heavier, but guarantees resolution.)
    fs.cpSync(origNodeModules, copyNodeModules, {
      recursive: true,
      dereference: false,
    });
  }

  const entryFile = resolveStagehandEntry(copyRoot);
  return { copyRoot, entryFile };
}

/** Dynamic import of Stagehand from a concrete entry file path. */
async function loadStagehandFromEntry(
  entryFile: string,
): Promise<StagehandCtor> {
  const url = pathToFileURL(entryFile).href;
  const mod = (await import(url)) as unknown as StagehandModule;
  if (!mod?.Stagehand) {
    throw new Error(`Stagehand not exported from ${entryFile}`);
  }
  return mod.Stagehand;
}

/** Load the installed Stagehand once via the package name. */
async function loadInstalledStagehand(): Promise<StagehandCtor> {
  const mod = (await import(
    "@browserbasehq/stagehand"
  )) as unknown as StagehandModule;
  return mod.Stagehand;
}

async function example(stagehand: StagehandType): Promise<void> {
  // Minimal usage is enough; the register happens during init().
  const page = stagehand.page;
  await page.goto("https://docs.stagehand.dev");
  await page.act("click the quickstart button");
}

async function runOnce(
  StagehandClass: StagehandCtor,
  label: string,
): Promise<void> {
  const s = new StagehandClass({ env: "LOCAL" });
  console.log(`[${label}] Stagehand.init()`);
  await s.init(); // <-- ensureStagehandSelectorEngine() runs here
  await example(s);
  await s.close();
  console.log(`[${label}] closed`);
}

(async () => {
  const stagehandRoot = resolveStagehandRoot();
  console.log(`[debug] StagehandA root: ${stagehandRoot}`);

  // 1) First load from the installed package (registers selector in Playwright).
  const StagehandA = await loadInstalledStagehand();
  await runOnce(StagehandA, "first-load");

  // 2) Second load from a physical copy in /tmp (fresh module instance).
  const { copyRoot, entryFile } = prepareExternalCopy(stagehandRoot);
  console.log(`[debug] StagehandB root (temp copy): ${copyRoot}`);
  const StagehandB = await loadStagehandFromEntry(entryFile);

  try {
    // 3) On init, Stagehand thinks it hasn't registered yet and tries again.
    //    Playwright throws "already registered" INSIDE Stagehand.
    await runOnce(StagehandB, "second-load");
  } catch (err) {
    if (err instanceof Error && /already registered/i.test(err.message)) {
      console.error(
        `[repro] Caught expected duplicate-registration error inside Stagehand: ${err.message}`,
      );
      process.exitCode = 1; // optional: make failure visible to CI
      return;
    }
    throw err; // surface unexpected errors
  }
})();
