import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { addModel, parseModelName } from "../../../../scripts/add-model.js";

const fixture = `export const OpenAIModelIdSchema = z
  .enum([
    "gpt-existing",
  ])
  .meta({ id: "OpenAIModelId" });\n`;

describe("add-model", () => {
  it("keeps the provider prefix and supports model IDs that contain slashes", () => {
    expect(parseModelName("groq/meta-llama/llama-4")).toStrictEqual({
      provider: "groq",
      modelId: "meta-llama/llama-4",
    });
  });

  it("rejects malformed and unsupported provider names", () => {
    expect(() => parseModelName("gpt-5")).toThrow("provider-qualified");
    expect(() => parseModelName("vertex/gpt-5")).toThrow("Unsupported provider");
  });

  it("adds an entry once and rejects duplicates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stagehand-model-catalog-"));
    const path = join(directory, "schemas.ts");
    await writeFile(path, fixture);

    await addModel("openai/gpt-new", path);
    expect(await readFile(path, "utf8")).toContain('    "gpt-new",');
    await expect(addModel("openai/gpt-new", path)).rejects.toThrow("already cataloged");
  });

  it("preserves dollar-sign sequences and escaped IDs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stagehand-model-catalog-"));
    const path = join(directory, "schemas.ts");
    await writeFile(path, fixture);

    await addModel('openai/gpt-$&-\\"preview', path);
    const source = await readFile(path, "utf8");
    expect(source).toContain('    "gpt-$&-\\\\\\"preview",');
    await expect(addModel('openai/gpt-$&-\\"preview', path)).rejects.toThrow("already cataloged");
  });
});
