import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fail } from "../errors.js";
import { defaultSkillsApiBaseUrl, isRecord, responseDetail } from "./shared.js";

const defaultBlobBaseUrl =
  "https://gh0lfhlmyzhg6tww.public.blob.vercel-storage.com";
const generatedSkillSuffixPattern = /-[A-Za-z0-9]{6}$/;
const domainPattern = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const taskPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const maxSkillFiles = 100;

export interface ParsedSkillId {
  domain: string;
  task: string;
  id: string;
}

interface BlobDownloadResult {
  installPath: string;
  fileCount: number;
}

interface SkillFileSource {
  path: string;
  url: URL;
}

type SkillFilesApiResult =
  | {
      status: "found";
      files: SkillFileSource[];
    }
  | {
      status: "not_found" | "unavailable";
    };

type SkillFilesResult =
  | {
      status: "found";
      files: SkillFileSource[];
    }
  | {
      // The catalog responded with a definitive 404 for a non-generated id.
      status: "not_found";
    }
  | {
      // Either the API was unavailable or the id is suffix-shaped (generated)
      // and may still resolve through the browse.sh GitHub clone fallback.
      status: "fallback";
    };

const maxCapturedOutputBytes = 2048;

export function parseSkillId(rawSkillId: string): ParsedSkillId {
  const parts = rawSkillId.split("/");
  if (parts.length !== 2) {
    fail("Skill must be in the form <domain>/<task>.", 1, {
      resultCode: "invalid_skill_id",
    });
  }

  const [domain, task] = parts;
  if (!domain || !task) {
    fail("Skill must be in the form <domain>/<task>.", 1, {
      resultCode: "invalid_skill_id",
    });
  }

  if (
    rawSkillId.includes("\\") ||
    domain === "." ||
    domain === ".." ||
    task === "." ||
    task === ".." ||
    !domainPattern.test(domain) ||
    !taskPattern.test(task)
  ) {
    fail(`Invalid skill id "${rawSkillId}". Use <domain>/<task>.`, 1, {
      resultCode: "invalid_skill_id",
    });
  }

  return {
    domain,
    task,
    id: rawSkillId,
  };
}

export function isBlobSkillId(skillId: ParsedSkillId): boolean {
  return generatedSkillSuffixPattern.test(skillId.task);
}

export async function installSkill(rawSkillId: string): Promise<void> {
  const skillId = parseSkillId(rawSkillId);
  const npxPath = await findExecutable("npx");
  if (!npxPath) {
    fail(
      "`npx` is not installed. Install Node.js from https://nodejs.org, then rerun `browse skills add`.",
      1,
      { resultCode: "npx_missing" },
    );
  }

  const files = await fetchSkillFiles(skillId);
  if (files.status === "found") {
    const result = await downloadBlobSkill(skillId, files.files);
    process.stdout.write(
      `Downloaded ${result.fileCount} skill file${result.fileCount === 1 ? "" : "s"} to ${result.installPath}\n`,
    );
    await runSkillsInstall(npxPath, [
      "--yes",
      "skills",
      "add",
      result.installPath,
    ]);
    return;
  }

  if (files.status === "not_found") {
    fail(
      `Skill "${skillId.id}" not found in the catalog. Run \`browse skills find ${skillId.domain}\` to discover available skills, or \`browse skills list\` to browse them.`,
      1,
      { resultCode: "skill_not_found" },
    );
  }

  // Suffix-shaped (generated) ids, or a temporarily unavailable catalog, may
  // still resolve through the browse.sh GitHub repo.
  await runSkillsInstall(npxPath, [
    "--yes",
    "skills",
    "add",
    "browserbase/browse.sh",
    "--skill",
    skillId.id,
  ]);
}

export async function installBundledCliSkill(): Promise<void> {
  const npxPath = await findExecutable("npx");
  if (!npxPath) {
    fail(
      "`npx` is not installed. Install Node.js from https://nodejs.org, then rerun `browse skills install`.",
      1,
      { resultCode: "npx_missing" },
    );
  }

  await runSkillsInstall(npxPath, [
    "--yes",
    "skills",
    "add",
    bundledCliSkillPath(),
    "--yes",
    "--global",
    "--agent",
    "*",
  ]);
}

// Runs `npx skills add ...` with live passthrough, but fails with a diagnostic
// message (including a tail of the child's output) when the child exits nonzero
// so the failure is recorded in telemetry instead of an opaque exit code.
async function runSkillsInstall(
  npxPath: string,
  args: string[],
): Promise<void> {
  const result = await spawnPassthrough(npxPath, args);
  if (result.exitCode === 0) {
    return;
  }

  const detail = result.output.trim();
  const reason = detail
    ? `: ${detail}`
    : " (see the output above for details).";
  fail(`Could not install skill${reason}`, result.exitCode || 1, {
    resultCode: "skill_install_failed",
  });
}

export async function downloadBlobSkill(
  skillId: ParsedSkillId,
  files?: SkillFileSource[],
): Promise<BlobDownloadResult> {
  let filesToDownload = files;
  if (!filesToDownload) {
    const resolved = await fetchSkillFiles(skillId);
    if (resolved.status !== "found") {
      fail(`Skill ${skillId.id} was not found as a generated skill.`);
    }
    filesToDownload = resolved.files;
  }

  const installPath = localSkillPath(skillId);
  const parentDir = dirname(installPath);
  await mkdir(parentDir, { recursive: true });
  const tempDir = await mkdtemp(join(parentDir, `.${skillId.task}-`));

  try {
    for (const file of filesToDownload) {
      const contents = await fetchSkillFile(
        file.url,
        `${skillId.id}/${file.path}`,
      );
      const outputPath = join(tempDir, file.path);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, contents);
    }

    await rm(installPath, { recursive: true, force: true });
    await rename(tempDir, installPath);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    installPath,
    fileCount: filesToDownload.length,
  };
}

function localSkillPath(skillId: ParsedSkillId): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(
    configHome,
    "browserbase",
    "skills",
    skillId.domain,
    skillId.task,
  );
}

function bundledCliSkillPath(): string {
  return join(packageRoot(), "skills", "browse");
}

function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

async function fetchSkillFiles(
  skillId: ParsedSkillId,
): Promise<SkillFilesResult> {
  const apiResult = await fetchSkillFilesFromApi(skillId);
  if (apiResult.status === "found") {
    return { status: "found", files: apiResult.files };
  }

  if (
    apiResult.status === "unavailable" &&
    isBlobSkillId(skillId) &&
    (await directBlobSkillExists(skillId))
  ) {
    return {
      status: "found",
      files: [
        {
          path: "SKILL.md",
          url: skillBlobUrl(skillId, "SKILL.md"),
        },
      ],
    };
  }

  // Suffix-shaped ids correspond to generated catalog skills that live in the
  // browse.sh repo even when the file API can't serve them directly, so keep
  // the GitHub clone fallback for those. A plain 404 for a non-generated id is
  // a definitive miss and should fail cleanly instead of cloning the repo.
  if (apiResult.status === "not_found" && !isBlobSkillId(skillId)) {
    return { status: "not_found" };
  }

  return { status: "fallback" };
}

async function fetchSkillFilesFromApi(
  skillId: ParsedSkillId,
): Promise<SkillFilesApiResult> {
  const url = skillFilesApiUrl(skillId);
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return { status: "unavailable" };
  }

  if (response.status === 404) {
    return { status: "not_found" };
  }

  if (response.status >= 500) {
    return { status: "unavailable" };
  }

  if (!response.ok) {
    fail(
      `Could not list files for ${skillId.id}: ${response.status} ${response.statusText}${await responseDetail(response)}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    fail(
      `Could not parse file list for ${skillId.id}: ${(error as Error).message}`,
    );
  }

  return {
    status: "found",
    files: validateApiSkillFiles(payload, skillId.id),
  };
}

async function directBlobSkillExists(skillId: ParsedSkillId): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(skillBlobUrl(skillId, "SKILL.md"), {
      method: "HEAD",
    });
  } catch {
    return false;
  }

  return response.ok;
}

function validateApiSkillFiles(
  payload: unknown,
  skillId: string,
): SkillFileSource[] {
  if (!isRecord(payload) || !Array.isArray(payload.files)) {
    fail(
      `Invalid file list for ${skillId}: expected {"files":[{"path":"SKILL.md","url":"..."}]}.`,
    );
  }

  if (typeof payload.skillId === "string" && payload.skillId !== skillId) {
    fail(
      `Invalid file list for ${skillId}: response was for ${payload.skillId}.`,
    );
  }

  if (payload.files.length === 0) {
    fail(`Invalid file list for ${skillId}: files must include SKILL.md.`);
  }

  if (payload.files.length > maxSkillFiles) {
    fail(
      `Invalid file list for ${skillId}: expected ${maxSkillFiles} files or fewer.`,
    );
  }

  const files: SkillFileSource[] = [];
  const seenPaths = new Set<string>();
  for (const file of payload.files) {
    if (!isRecord(file)) {
      fail(
        `Invalid file list for ${skillId}: file entries must include path and url.`,
      );
    }

    const path = validateSkillFilePath(file.path, skillId);
    const url = validateSkillFileUrl(file.url, skillId, path);
    if (seenPaths.has(path)) {
      fail(`Invalid file list for ${skillId}: duplicate file path "${path}".`);
    }

    seenPaths.add(path);
    files.push({ path, url });
  }

  if (!seenPaths.has("SKILL.md")) {
    fail(`Invalid file list for ${skillId}: files must include SKILL.md.`);
  }

  return files;
}

function validateSkillFilePath(value: unknown, skillId: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(
      `Invalid file list for ${skillId}: file paths must be non-empty strings.`,
    );
  }

  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fail(`Invalid file list for ${skillId}: unsafe file path "${value}".`);
  }

  return value;
}

function validateSkillFileUrl(
  value: unknown,
  skillId: string,
  path: string,
): URL {
  if (typeof value !== "string" || value.length === 0) {
    fail(
      `Invalid file list for ${skillId}: file "${path}" must include a URL.`,
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(
      `Invalid file list for ${skillId}: file "${path}" has an invalid URL.`,
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail(
      `Invalid file list for ${skillId}: file "${path}" must use an HTTP URL.`,
    );
  }

  return url;
}

async function fetchSkillFile(url: URL, label: string): Promise<Uint8Array> {
  const response = await fetchFromUrl(url, label);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchFromUrl(url: URL, label: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    fail(`Could not download ${label}: ${(error as Error).message}`);
  }

  if (!response.ok) {
    fail(
      `Could not download ${label}: ${response.status} ${response.statusText}`,
    );
  }

  return response;
}

function skillFilesApiUrl(skillId: ParsedSkillId): URL {
  const baseUrl =
    process.env.BROWSE_SKILLS_API_BASE_URL || defaultSkillsApiBaseUrl;
  const pathname = ["api", "skills", skillId.domain, skillId.task, "files"]
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = new URL(
    pathname,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
  const bypassToken = process.env.BROWSE_ALPHA_TOKEN;
  if (bypassToken && !url.searchParams.has("x-vercel-protection-bypass")) {
    url.searchParams.append("x-vercel-protection-bypass", bypassToken);
  }
  return url;
}

function skillBlobUrl(skillId: ParsedSkillId, file: string): URL {
  const baseUrl = process.env.BROWSE_SKILLS_BLOB_BASE_URL || defaultBlobBaseUrl;
  const pathname = ["skills", skillId.domain, skillId.task, ...file.split("/")]
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

async function findExecutable(command: string): Promise<string | null> {
  const pathEnv = process.env.PATH;
  if (!pathEnv) {
    return null;
  }

  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
      : [""];

  for (const segment of pathEnv.split(delimiter)) {
    for (const extension of extensions) {
      const candidate = join(segment, `${command}${extension.toLowerCase()}`);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }

  return null;
}

interface SpawnPassthroughResult {
  exitCode: number;
  output: string;
}

// Like `stdio: "inherit"` for the human watching, but the child's stdout/stderr
// are also buffered (tail only) so a nonzero exit can surface a real reason to
// telemetry instead of a bare exit code.
async function spawnPassthrough(
  command: string,
  args: string[],
): Promise<SpawnPassthroughResult> {
  return await new Promise<SpawnPassthroughResult>((resolvePromise) => {
    const child = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
      shell: shouldUseWindowsShell(command),
    });

    let captured = "";
    const capture = (chunk: Buffer): void => {
      captured += chunk.toString();
      if (captured.length > maxCapturedOutputBytes) {
        captured = captured.slice(-maxCapturedOutputBytes);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      capture(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      capture(chunk);
    });

    // Resolve (not reject) on spawn errors so the failure is classified as
    // `skill_install_failed` by runSkillsInstall instead of escaping as an
    // unclassified runtime error.
    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      resolvePromise({
        exitCode: 1,
        output: captured ? `${captured}\n${message}` : message,
      });
    });
    child.on("close", (exitCode, signal) => {
      resolvePromise({
        exitCode: signal ? 1 : (exitCode ?? 0),
        output: captured,
      });
    });
  });
}

export function shouldUseWindowsShell(
  command: string,
  platform = process.platform,
): boolean {
  return platform === "win32" && /\.(?:bat|cmd)$/i.test(command);
}
