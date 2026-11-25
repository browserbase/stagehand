import { distance } from "fastest-levenshtein";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { resolveConfigDir } from "../identity.js";

const STORE_VERSION = 1;
const MAX_NAME_LENGTH = 64;
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const CONTEXT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ContextAlias {
  id: string;
  createdAt: string;
}

export type ContextAliasEntry = ContextAlias & { name: string };

interface ContextsStoreFile {
  version: number;
  contexts: Record<string, ContextAlias>;
}

export function looksLikeContextId(value: string): boolean {
  return CONTEXT_ID_PATTERN.test(value);
}

export function isValidContextName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_NAME_LENGTH &&
    NAME_PATTERN.test(name) &&
    !looksLikeContextId(name)
  );
}

export function contextNameRequirement(): string {
  return `Context names must be 1-${MAX_NAME_LENGTH} characters, start with a letter or number, contain only letters, numbers, dots, dashes, or underscores, and not look like a context ID.`;
}

export function contextsStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveConfigDir(env), "contexts.json");
}

function emptyStore(): ContextsStoreFile {
  return {
    version: STORE_VERSION,
    contexts: Object.create(null) as Record<string, ContextAlias>,
  };
}

async function readStore(env: NodeJS.ProcessEnv = process.env): Promise<ContextsStoreFile> {
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
      contexts: sanitizeContexts(parsed.contexts),
    };
  } catch {
    return emptyStore();
  }
}

function sanitizeContexts(raw: unknown): Record<string, ContextAlias> {
  const result: Record<string, ContextAlias> = Object.create(null);
  if (!raw || typeof raw !== "object") {
    return result;
  }
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidContextName(name)) {
      continue;
    }
    if (!value || typeof value !== "object") {
      continue;
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      continue;
    }
    result[name] = {
      id: entry.id,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
    };
  }
  return result;
}

async function writeStore(
  store: ContextsStoreFile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = contextsStorePath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Write to a temp file at 0600 then atomically rename over the target. The
  // rename means a reader never sees a half-written file, and the final file
  // always inherits the temp file's 0600 perms even if an older, more permissive
  // contexts.json already existed (writeFile's `mode` only applies on create).
  // For this single-user local config, simultaneous writers remain
  // last-writer-wins; cross-process locking isn't warranted here.
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tempPath, path);
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

export async function resolveContextRef(
  ref: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const alias = await getContextAlias(ref, env);
  return alias ? alias.id : ref;
}

export interface ContextRefResolution {
  id: string | null;
  suggestions: string[];
}

export async function resolveContextRefDetailed(
  ref: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ContextRefResolution> {
  const store = await readStore(env);
  const alias = store.contexts[ref];
  if (alias) {
    return { id: alias.id, suggestions: [] };
  }
  if (looksLikeContextId(ref)) {
    return { id: ref, suggestions: [] };
  }
  return {
    id: null,
    suggestions: closeContextNameMatches(ref, Object.keys(store.contexts)),
  };
}

export function closeContextNameMatches(ref: string, names: string[], limit = 3): string[] {
  return names
    .map((name) => ({ name, d: distance(ref, name) }))
    .filter(({ name, d }) => d <= Math.max(2, Math.floor(name.length / 3)))
    .sort((a, b) => a.d - b.d || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((match) => match.name);
}
