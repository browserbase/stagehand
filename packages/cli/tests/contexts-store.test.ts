import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  contextsStorePath,
  getContextAlias,
  isValidContextName,
  listContextAliases,
  removeContextAlias,
  removeContextAliasesById,
  resolveContextRef,
  saveContextAlias,
} from "../src/lib/cloud/contexts-store.js";

let configDir: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "browse-contexts-"));
  // resolveConfigDir() appends the `browserbase` segment itself only for the
  // XDG path; BROWSERBASE_CONFIG_DIR is used verbatim, so point it at our temp.
  env = { BROWSERBASE_CONFIG_DIR: configDir };
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

describe("isValidContextName", () => {
  it("accepts friendly names", () => {
    for (const name of ["github", "g", "my-ctx", "ctx_1", "a.b.c", "A1"]) {
      expect(isValidContextName(name)).toBe(true);
    }
  });

  it("rejects empty, leading-punct, spaces, slashes, and over-long names", () => {
    for (const name of [
      "",
      "-x",
      ".x",
      "_x",
      "a b",
      "a/b",
      "a:b",
      "x".repeat(65),
    ]) {
      expect(isValidContextName(name)).toBe(false);
    }
  });
});

describe("contexts store", () => {
  it("starts empty when no file exists", async () => {
    expect(await listContextAliases(env)).toEqual([]);
    expect(await getContextAlias("github", env)).toBeUndefined();
  });

  it("saves, lists (sorted), and gets aliases", async () => {
    await saveContextAlias(
      "zebra",
      { id: "ctx_z", createdAt: "2026-01-02T00:00:00.000Z" },
      env,
    );
    await saveContextAlias(
      "alpha",
      { id: "ctx_a", createdAt: "2026-01-01T00:00:00.000Z" },
      env,
    );

    const list = await listContextAliases(env);
    expect(list.map((c) => c.name)).toEqual(["alpha", "zebra"]);
    expect(await getContextAlias("alpha", env)).toEqual({
      id: "ctx_a",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("writes the store to contexts.json with 0600 perms", async () => {
    await saveContextAlias(
      "github",
      { id: "ctx_g", createdAt: "2026-01-01T00:00:00.000Z" },
      env,
    );
    const path = contextsStorePath(env);
    expect(path).toBe(join(configDir, "contexts.json"));

    const parsed = JSON.parse(await readFile(path, "utf8"));
    expect(parsed).toMatchObject({
      version: 1,
      contexts: { github: { id: "ctx_g" } },
    });
  });

  it("resolves a saved name to its id and passes unknown refs through", async () => {
    await saveContextAlias(
      "github",
      { id: "ctx_g", createdAt: "2026-01-01T00:00:00.000Z" },
      env,
    );
    expect(await resolveContextRef("github", env)).toBe("ctx_g");
    // A raw id (or any unknown ref) is returned unchanged.
    expect(await resolveContextRef("ctx_raw_123", env)).toBe("ctx_raw_123");
  });

  it("removes aliases by name and by id", async () => {
    await saveContextAlias(
      "a",
      { id: "ctx_shared", createdAt: "2026-01-01T00:00:00.000Z" },
      env,
    );
    await saveContextAlias(
      "b",
      { id: "ctx_shared", createdAt: "2026-01-01T00:00:00.000Z" },
      env,
    );
    await saveContextAlias(
      "c",
      { id: "ctx_other", createdAt: "2026-01-01T00:00:00.000Z" },
      env,
    );

    expect(await removeContextAlias("a", env)).toBe(true);
    expect(await removeContextAlias("missing", env)).toBe(false);

    const prunedByMissingId = await removeContextAliasesById("ctx_nope", env);
    expect(prunedByMissingId).toEqual([]);

    const pruned = await removeContextAliasesById("ctx_shared", env);
    expect(pruned).toEqual(["b"]);

    expect((await listContextAliases(env)).map((c) => c.name)).toEqual(["c"]);
  });

  it("treats a corrupt store file as empty rather than throwing", async () => {
    await writeFile(contextsStorePath(env), "{ not json", "utf8");
    expect(await listContextAliases(env)).toEqual([]);
  });
});
