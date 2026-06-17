import type { DriverCommandName } from "../driver/commands/types.js";
import {
  clearRecordingState,
  loadMacro,
  readRecordingState,
  saveMacro,
  writeRecordingState,
} from "./store.js";
import type { BrowseMacro, MacroStep } from "./types.js";

const NON_RECORDABLE_COMMANDS = new Set<DriverCommandName>([
  "cursor",
  "refs",
  "snapshot",
  "tab.list",
]);

export async function startMacroRecording(name: string): Promise<void> {
  const active = await readRecordingState();
  if (active) {
    throw new Error(
      `Already recording macro "${active.name}". Run browse macro stop first.`,
    );
  }

  try {
    await loadMacro(name);
    throw new Error(
      `Macro "${name}" already exists. Choose a different name or delete the existing macro first.`,
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("not found")) {
      throw error;
    }
  }

  await writeRecordingState({
    name,
    startedAt: new Date().toISOString(),
    steps: [],
  });
}

export async function stopMacroRecording(): Promise<BrowseMacro> {
  const active = await readRecordingState();
  if (!active) {
    throw new Error(
      "No macro recording in progress. Run browse macro record <name> first.",
    );
  }

  const macro: BrowseMacro = {
    createdAt: active.startedAt,
    name: active.name,
    steps: active.steps,
  };

  await saveMacro(macro);
  await clearRecordingState();
  return macro;
}

export async function appendMacroStepIfRecording(
  command: DriverCommandName,
  params: unknown,
): Promise<void> {
  if (NON_RECORDABLE_COMMANDS.has(command)) {
    return;
  }

  const active = await readRecordingState();
  if (!active) {
    return;
  }

  const step: MacroStep = { command, params };
  active.steps.push(step);
  await writeRecordingState(active);
}

export async function getActiveRecordingName(): Promise<string | null> {
  const active = await readRecordingState();
  return active?.name ?? null;
}
