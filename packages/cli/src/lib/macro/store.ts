import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensurePrivateDir,
  PRIVATE_FILE_MODE,
  runtimeDir,
  writePrivateFile,
} from "../driver/daemon/paths.js";
import type { BrowseMacro, MacroRecordingState } from "./types.js";

const MACRO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function macrosDir(): string {
  return (
    process.env.BROWSE_MACRO_DIR ?? path.join(os.homedir(), ".browse", "macros")
  );
}

export function recordingStatePath(): string {
  return path.join(runtimeDir(), "macro-recording.json");
}

export function assertValidMacroName(name: string): void {
  if (!MACRO_NAME_RE.test(name)) {
    throw new Error(
      `Invalid macro name "${name}". Use 1-64 characters: letters, numbers, ".", "_", or "-".`,
    );
  }
}

export function macroFilePath(name: string): string {
  assertValidMacroName(name);
  return path.join(macrosDir(), `${name}.json`);
}

export async function ensureMacrosDir(): Promise<string> {
  const dir = macrosDir();
  await ensurePrivateDir(dir);
  return dir;
}

export async function loadMacro(name: string): Promise<BrowseMacro> {
  const file = macroFilePath(name);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Macro "${name}" not found.`);
    }
    throw error;
  }

  const parsed = JSON.parse(raw) as BrowseMacro;
  if (!parsed.name || !Array.isArray(parsed.steps)) {
    throw new Error(`Macro "${name}" is invalid or corrupted.`);
  }

  return parsed;
}

export async function saveMacro(macro: BrowseMacro): Promise<string> {
  await ensureMacrosDir();
  const file = macroFilePath(macro.name);
  await writePrivateFile(file, `${JSON.stringify(macro, null, 2)}\n`);
  return file;
}

export async function listMacroNames(): Promise<string[]> {
  await ensureMacrosDir();
  const entries = await fs.readdir(macrosDir(), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -".json".length))
    .sort((a, b) => a.localeCompare(b));
}

export async function readRecordingState(): Promise<MacroRecordingState | null> {
  try {
    const raw = await fs.readFile(recordingStatePath(), "utf8");
    const parsed = JSON.parse(raw) as MacroRecordingState;
    if (!parsed.name || !Array.isArray(parsed.steps)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeRecordingState(
  state: MacroRecordingState,
): Promise<void> {
  await ensurePrivateDir(runtimeDir());
  await writePrivateFile(recordingStatePath(), `${JSON.stringify(state)}\n`);
}

export async function clearRecordingState(): Promise<void> {
  await fs.unlink(recordingStatePath()).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  });
}
