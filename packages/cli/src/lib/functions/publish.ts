import archiver from "archiver";
import ignore from "ignore";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";

import { fail } from "../errors.js";
import { setRunTelemetryCompletion } from "../run-telemetry.js";
import {
  functionsGet,
  functionsRequest,
  pollUntil,
  resolveEntrypoint,
  resolveFunctionsApiConfig,
} from "./shared.js";

export interface PublishFunctionOptions {
  apiKey?: string;
  baseUrl?: string;
  dryRun: boolean;
  entrypoint: string;
}

interface BuildUploadResponse {
  id?: string;
}

interface BuildStatusResponse {
  id: string;
  status: string;
  request?: {
    entrypoint?: string;
  };
  builtFunctions?: Array<{
    id: string;
    name: string;
    createdVersion?: {
      id: string;
    };
  }>;
}

const defaultIgnorePatterns = [
  "node_modules/",
  ".git/",
  ".env",
  ".env.*",
  "*.log",
  ".DS_Store",
  "dist/",
  "build/",
  "*.zip",
  "*.tar",
  "*.tar.gz",
  ".vscode/",
  ".idea/",
  ".browserbase/",
];

export async function publishFunction(
  options: PublishFunctionOptions,
): Promise<void> {
  const entrypoint = await resolveEntrypoint(options.entrypoint);
  const config = resolveFunctionsApiConfig(options);
  const entrypointPath = relative(process.cwd(), entrypoint);

  if (options.dryRun) {
    const entries = await listPublishEntries(process.cwd());
    console.log(
      JSON.stringify(
        {
          archivePath: null,
          baseUrl: config.baseUrl,
          dryRun: true,
          entrypoint: entrypointPath,
          files: entries,
        },
        null,
        2,
      ),
    );
    return;
  }

  const { archivePath } = await createArchive(process.cwd());
  try {
    const formData = new FormData();
    formData.append("metadata", JSON.stringify({ entrypoint: entrypointPath }));
    formData.append(
      "archive",
      new Blob([await readFile(archivePath)], { type: "application/gzip" }),
      "archive.tar.gz",
    );

    const uploadResponse = await functionsRequest(
      config,
      "/v1/functions/builds",
      {
        method: "POST",
        body: formData,
      },
    );

    const uploaded = (await uploadResponse.json()) as BuildUploadResponse;
    if (!uploaded.id) {
      fail("Build upload completed without returning a build ID.", 1, {
        resultCode: "functions_build_missing_id",
      });
    }

    const build = await pollUntil(
      () =>
        functionsGet<BuildStatusResponse>(
          config,
          `/v1/functions/builds/${uploaded.id}`,
        ),
      {
        done: (result) => !["PENDING", "RUNNING"].includes(result.status),
        intervalMs: 2_000,
        maxAttempts: 100,
      },
    );

    console.log(JSON.stringify(build, null, 2));

    if (build.status === "FAILED") {
      setRunTelemetryCompletion({
        resultCode: "functions_build_failed",
      });
      process.exitCode = 1;
    }
  } finally {
    rmSync(archivePath, { force: true });
  }
}

async function createArchive(root: string): Promise<{
  archivePath: string;
  entries: string[];
}> {
  const archivePath = join(
    tmpdir(),
    `browserbase-functions-${randomUUID()}.tar.gz`,
  );
  const sourceEntries = await listPublishEntries(root);
  const { entries, generatedLockfilePath } = ensureArchiveLockfile(
    root,
    sourceEntries,
  );

  try {
    await new Promise<void>((resolvePromise, reject) => {
      const output = createWriteStream(archivePath);
      const archive = archiver("tar", {
        gzip: true,
        gzipOptions: { level: 9 },
      });

      archive.on("error", reject);
      archive.on("warning", (warning: Error & { code?: string }) => {
        if (warning.code === "ENOENT") {
          return;
        }
        reject(warning);
      });
      output.on("close", () => resolvePromise());
      output.on("error", reject);

      archive.pipe(output);

      for (const entry of entries) {
        if (entry === "package-lock.json" && generatedLockfilePath) {
          archive.file(generatedLockfilePath, { name: entry });
        } else {
          archive.file(join(root, entry), { name: entry });
        }
      }

      archive.finalize().catch(reject);
    });
  } finally {
    if (generatedLockfilePath) {
      rmSync(dirname(generatedLockfilePath), { recursive: true, force: true });
    }
  }

  return { archivePath, entries };
}

async function listPublishEntries(root: string): Promise<string[]> {
  const ignoreMatcher = await loadIgnoreMatcher(root);
  return await listArchiveEntries(root, root, ignoreMatcher);
}

function ensureArchiveLockfile(
  root: string,
  entries: string[],
): { entries: string[]; generatedLockfilePath?: string } {
  if (
    !entries.includes("package.json") ||
    entries.includes("package-lock.json")
  ) {
    return { entries };
  }

  const tempDir = join(tmpdir(), `bb-functions-lockgen-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  copyFileSync(join(root, "package.json"), join(tempDir, "package.json"));

  const result = spawnSync("npm", ["install", "--package-lock-only"], {
    cwd: tempDir,
    stdio: "pipe",
  });

  if (result.status !== 0) {
    rmSync(tempDir, { recursive: true, force: true });
    fail(
      "Failed to generate package-lock.json for the Functions build archive.",
    );
  }

  return {
    entries: [...entries, "package-lock.json"].sort(),
    generatedLockfilePath: join(tempDir, "package-lock.json"),
  };
}

async function loadIgnoreMatcher(root: string) {
  const matcher = ignore();
  matcher.add(defaultIgnorePatterns);

  const gitignorePath = join(root, ".gitignore");
  if (existsSync(gitignorePath)) {
    matcher.add(readFileSync(gitignorePath, "utf8"));
  }

  return matcher;
}

async function listArchiveEntries(
  root: string,
  current: string,
  matcher: ignore.Ignore,
): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    const relativePath = relative(root, absolutePath) || ".";
    const ignorePath = entry.isDirectory() ? `${relativePath}/` : relativePath;

    if (relativePath !== "." && matcher.ignores(ignorePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await listArchiveEntries(root, absolutePath, matcher)));
      continue;
    }

    const fileStats = await stat(absolutePath);
    if (fileStats.isFile()) {
      files.push(relativePath);
    }
  }

  return files.sort();
}
