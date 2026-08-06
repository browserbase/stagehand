import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  STAGEHAND_CODEMODE_REFERENCE,
  STAGEHAND_CODEMODE_SKILL,
} from "../src/codemode/generated-content.js";
import { CODE_EXECUTE_DESCRIPTION } from "../src/codemode/tool-contract.js";

const execFileAsync = promisify(execFile);
const packageRoot = new URL("..", import.meta.url);
const temporaryRoots: string[] = [];

describe("generated code-mode content", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("matches the committed Markdown assets", async () => {
    const [skill, reference] = await Promise.all([
      readFile(new URL("codemode/SKILL.md", packageRoot), "utf8"),
      readFile(new URL("codemode/REFERENCE.md", packageRoot), "utf8"),
    ]);

    expect(STAGEHAND_CODEMODE_SKILL).toBe(skill.trim());
    expect(STAGEHAND_CODEMODE_REFERENCE).toBe(reference.trim());
  });

  it("resolves the raw Markdown assets through package exports", async () => {
    const [skill, reference] = await Promise.all([
      readFile(
        new URL(import.meta.resolve("@browserbasehq/stagehand-integrations/codemode/SKILL.md")),
        "utf8",
      ),
      readFile(
        new URL(import.meta.resolve("@browserbasehq/stagehand-integrations/codemode/REFERENCE.md")),
        "utf8",
      ),
    ]);

    expect(skill.trim()).toBe(STAGEHAND_CODEMODE_SKILL);
    expect(reference.trim()).toBe(STAGEHAND_CODEMODE_REFERENCE);
  });

  it("embeds the complete generated skill in the tool description", () => {
    expect(CODE_EXECUTE_DESCRIPTION).toContain("Execute an async JavaScript function body");
    expect(CODE_EXECUTE_DESCRIPTION.endsWith(STAGEHAND_CODEMODE_SKILL)).toBe(true);
  });

  it("passes the committed stale-content check", async () => {
    await expect(
      execFileAsync(process.execPath, ["scripts/generate-codemode-content.mjs", "--check"], {
        cwd: packageRoot,
      }),
    ).resolves.toMatchObject({ stdout: "Generated code-mode content is current\n" });
  });

  it("escapes special characters and rejects stale output", async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), "stagehand-codemode-generator-"));
    temporaryRoots.push(fixtureRoot);
    await Promise.all([
      mkdir(path.join(fixtureRoot, "scripts"), { recursive: true }),
      mkdir(path.join(fixtureRoot, "codemode"), { recursive: true }),
      mkdir(path.join(fixtureRoot, "src", "codemode"), { recursive: true }),
    ]);
    await copyFile(
      new URL("scripts/generate-codemode-content.mjs", packageRoot),
      path.join(fixtureRoot, "scripts", "generate-codemode-content.mjs"),
    );
    await writeFile(
      path.join(fixtureRoot, "codemode", "SKILL.md"),
      "slash\\ quote' carriage\rreturn\nline\ttab\u2028separator\u2029paragraph",
    );
    await writeFile(path.join(fixtureRoot, "codemode", "REFERENCE.md"), "reference");

    await execFileAsync(process.execPath, ["scripts/generate-codemode-content.mjs"], {
      cwd: fixtureRoot,
    });
    const generated = await readFile(
      path.join(fixtureRoot, "src", "codemode", "generated-content.ts"),
      "utf8",
    );
    expect(generated).toContain("slash\\\\");
    expect(generated).toContain("quote\\'");
    expect(generated).toContain("carriage\\rreturn\\nline\\ttab");
    expect(generated).toContain("\\u2028separator\\u2029paragraph");

    await execFileAsync(process.execPath, ["scripts/generate-codemode-content.mjs", "--check"], {
      cwd: fixtureRoot,
    });
    await writeFile(path.join(fixtureRoot, "codemode", "SKILL.md"), "changed");

    await expect(
      execFileAsync(process.execPath, ["scripts/generate-codemode-content.mjs", "--check"], {
        cwd: fixtureRoot,
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Generated code-mode content is stale"),
    });
  });
});
