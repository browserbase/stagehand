import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { MODEL_PROVIDERS } from "../packages/protocol/modelCatalog.ts";

const catalogPath = fileURLToPath(new URL("../packages/protocol/modelCatalog.ts", import.meta.url));

export function parseModelName(value: string): {
  provider: (typeof MODEL_PROVIDERS)[number];
  modelId: string;
} {
  const separator = value.indexOf("/");
  const provider = value.slice(0, separator);
  const modelId = value.slice(separator + 1);

  if (separator <= 0 || !modelId) {
    throw new Error("Expected a provider-qualified model name, such as openai/gpt-5.");
  }

  if (!MODEL_PROVIDERS.includes(provider as (typeof MODEL_PROVIDERS)[number])) {
    throw new Error(
      `Unsupported provider "${provider}". Choose one of: ${MODEL_PROVIDERS.join(", ")}.`,
    );
  }

  return { provider: provider as (typeof MODEL_PROVIDERS)[number], modelId };
}

export async function addModel(modelName: string, path = catalogPath): Promise<void> {
  const { provider, modelId } = parseModelName(modelName);
  const source = await readFile(path, "utf8");
  const catalogEntry = new RegExp(`(  ${provider}: \\[\\n)([\\s\\S]*?)(  \\],)`);
  const match = source.match(catalogEntry);

  if (!match) {
    throw new Error(`Could not find the ${provider} catalog entry.`);
  }

  if (match[2].includes(`"${modelId}"`)) {
    throw new Error(`Model "${modelName}" is already cataloged.`);
  }

  const updated = source.replace(catalogEntry, `$1$2    ${JSON.stringify(modelId)},\n$3`);
  await writeFile(path, updated);
}

async function main(): Promise<void> {
  const [modelName, ...extraArguments] = process.argv.slice(2);
  if (!modelName || extraArguments.length > 0) {
    throw new Error("Usage: just add-model <provider/model>");
  }

  await addModel(modelName);
  process.stdout.write(`Added ${modelName} to the curated model catalog.\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
