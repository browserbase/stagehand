import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { resolveConfigDir } from "../identity.js";

/**
 * Local name -> Browserbase context-id map.
 *
 * Browserbase contexts are identified only by an opaque id and the platform has
 * no server-side list endpoint, so to give contexts memorable names (e.g.
 * `github`, `gmail`) we keep a small map on the local device. It lives next to
 * the CLI's other state at `(XDG_CONFIG_HOME||~/.config)/browserbase/contexts.json`
 * (honoring `BROWSERBASE_CONFIG_DIR`). This is purely a client-side convenience:
 * the ids it stores are the same ids the API already returns, and a missing or
 * corrupt file degrades to "no saved contexts" rather than an error.
 */

const STORE_VERSION = 1;
const MAX_NAME_LENGTH = 64;
// A name must start with an alphanumeric and may then contain letters, digits,
// dots, dashes, and underscores. Keeps names shell- and filename-friendly and
// unambiguous against opaque context ids.
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export interface ContextAlias {
  id: string;
  createdAt: string;
  projectId?: string;
}

export type ContextAliasEntry = ContextAlias & { name: string };

interface ContextsStoreFile {
  version: number;
  contexts: Record<string, ContextAlias>;
}

export function isValidContextName(name: string): boolean {
  return (
    name.length > 0 && name.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(name)
  );
}

export function contextNameRequirement(): string {
  return `Context names must be 1-${MAX_NAME_LENGTH} characters, start with a letter or number, and contain only letters, numbers, dots, dashes, or underscores.`;
}

export function contextsStorePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveConfigDir(env), "contexts.json");
}

function emptyStore(): ContextsStoreFile {
  return { version: STORE_VERSION, contexts: {} };
}

async function readStore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ContextsStoreFile> {
  let raw: string;
  try {
    raw = await readFile(contextsStorePath(env), "utf8");
  } catch {
    return emptyStore();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ContextsStoreFile> | null;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.contexts !== "object" ||
      parsed.contexts === null
    ) {
      return emptyStore();
    }
    return {
      version: STORE_VERSION,
      contexts: parsed.contexts as Record<string, ContextAlias>,
    };
  } catch {
    // Corrupt file: treat as empty rather than crashing the command.
    return emptyStore();
  }
}

async function writeStore(
  store: ContextsStoreFile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = contextsStorePath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function listContextAliases(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ContextAliasEntry[]> {
  const store = await readStore(env);
  return Object.entries(store.contexts)
    .map(([name, alias]) => ({ name, ...alias }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getContextAlias(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ContextAlias | undefined> {
  const store = await readStore(env);
  return store.contexts[name];
}

export async function saveContextAlias(
  name: string,
  alias: ContextAlias,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const store = await readStore(env);
  store.contexts[name] = alias;
  await writeStore(store, env);
}

export async function removeContextAlias(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const store = await readStore(env);
  if (!(name in store.contexts)) {
    return false;
  }
  delete store.contexts[name];
  await writeStore(store, env);
  return true;
}

/**
 * Drop any saved aliases that point at a given context id. Used after a delete
 * so the local map never references a context that no longer exists, regardless
 * of whether the user deleted it by name or by raw id. Returns the names pruned.
 */
export async function removeContextAliasesById(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const store = await readStore(env);
  const removed = Object.entries(store.contexts)
    .filter(([, alias]) => alias.id === id)
    .map(([name]) => name);
  if (removed.length === 0) {
    return [];
  }
  for (const name of removed) {
    delete store.contexts[name];
  }
  await writeStore(store, env);
  return removed;
}

/**
 * Resolve a context reference that may be a locally-saved name or a raw
 * Browserbase context id. If `ref` matches a saved name, returns its id;
 * otherwise returns `ref` unchanged (assumed to already be a context id). Never
 * throws — an unknown ref simply passes through to the API.
 */
export async function resolveContextRef(
  ref: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const alias = await getContextAlias(ref, env);
  return alias ? alias.id : ref;
}
