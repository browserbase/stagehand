import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { detectAgent } from "./agent.js";
import { isBrowseSkillInstalled } from "./skill-presence.js";

// When the calling agent exposes no per-session id, fall back to a time window
// so a tight command loop sees the nudge at most once per window while a fresh
// session some hours later still gets a reminder.
const NUDGE_FALLBACK_TTL_MS = 4 * 60 * 60 * 1000;
const NUDGE_STORE_PRUNE_MS = 7 * 24 * 60 * 60 * 1000;

interface SkillNudgeOptions {
  cacheFile?: string;
  commandId?: string;
  now?: number;
}

interface SkillNudgeStore {
  shown: Record<string, number>;
}

interface NudgeKey {
  key: string;
  sessionScoped: boolean;
}

/**
 * Once-per-session, agent-only nudge to install the browse skill, printed to
 * stderr so it never corrupts machine-readable stdout. Best-effort: any failure
 * is swallowed so it can never affect CLI behavior. Humans (no detected agent)
 * are pointed to the skill via the root help banner instead.
 */
export async function maybeNudgeInstallSkill(
  env: NodeJS.ProcessEnv = process.env,
  options: SkillNudgeOptions = {},
): Promise<void> {
  if (isNudgeDisabled(env)) {
    return;
  }

  // The user is already engaging with skills; don't nudge on those commands or
  // on bare/`--help` invocations (the help banner covers discovery there).
  const commandId = options.commandId;
  if (!commandId || commandId === "help" || commandId.startsWith("skills")) {
    return;
  }

  const cachePath = options.cacheFile;
  if (!cachePath) {
    return;
  }

  const agent = await detectAgent();
  if (!agent) {
    return;
  }

  if (await isBrowseSkillInstalled(agent, env)) {
    return;
  }

  const now = options.now ?? Date.now();
  const { key, sessionScoped } = resolveNudgeKey(agent, env);
  const store = await readNudgeStore(cachePath);

  const lastShown = store.shown[key];
  if (lastShown !== undefined) {
    if (sessionScoped) {
      return;
    }
    if (now - lastShown < NUDGE_FALLBACK_TTL_MS) {
      return;
    }
  }

  writeNudge();

  store.shown[key] = now;
  pruneNudgeStore(store, now);
  await writeNudgeStore(cachePath, store);
}

function resolveNudgeKey(agent: string, env: NodeJS.ProcessEnv): NudgeKey {
  // Real per-session identifiers exposed by some harnesses. Claude Code, Gemini,
  // etc. expose only a boolean, so they fall through to the TTL window.
  const sessionId = firstNonEmpty(env.CODEX_THREAD_ID, env.CURSOR_TRACE_ID);
  if (sessionId) {
    return { key: `${agent}:session:${sessionId}`, sessionScoped: true };
  }
  return { key: `${agent}:window`, sessionScoped: false };
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function writeNudge(): void {
  process.stderr.write(
    [
      "Tip: browse works best with its skill loaded into your agent.",
      "Run:",
      "  browse skills install",
      "",
    ].join("\n"),
  );
}

function isNudgeDisabled(env: NodeJS.ProcessEnv): boolean {
  if (
    env.BROWSE_DISABLE_SKILL_NUDGE === "1" ||
    env.BB_DISABLE_SKILL_NUDGE === "1"
  ) {
    return true;
  }
  if (env.NODE_ENV === "test") {
    return true;
  }
  return isCiEnvironment(env);
}

function isCiEnvironment(env: NodeJS.ProcessEnv): boolean {
  const value = env.CI;
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return !(
    normalized === "" ||
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  );
}

async function readNudgeStore(cachePath: string): Promise<SkillNudgeStore> {
  try {
    const contents = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(contents) as { shown?: unknown };
    if (parsed && typeof parsed.shown === "object" && parsed.shown !== null) {
      const shown: Record<string, number> = {};
      for (const [key, value] of Object.entries(
        parsed.shown as Record<string, unknown>,
      )) {
        if (typeof value === "number" && Number.isFinite(value)) {
          shown[key] = value;
        }
      }
      return { shown };
    }
  } catch {
    // Missing or unreadable store; start fresh.
  }
  return { shown: {} };
}

async function writeNudgeStore(
  cachePath: string,
  store: SkillNudgeStore,
): Promise<void> {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(store)}\n`, "utf8");
  } catch {
    // Best-effort cache writes should never affect CLI behavior.
  }
}

function pruneNudgeStore(store: SkillNudgeStore, now: number): void {
  for (const [key, shownAt] of Object.entries(store.shown)) {
    if (now - shownAt >= NUDGE_STORE_PRUNE_MS) {
      delete store.shown[key];
    }
  }
}
