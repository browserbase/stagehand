import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PROVIDER_SCHEMAS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  groq: "Groq",
  cerebras: "Cerebras",
} as const;

const catalogPath = fileURLToPath(new URL("../packages/protocol/schemas.ts", import.meta.url));

export function parseModelName(value: string): {
  provider: keyof typeof PROVIDER_SCHEMAS;
  modelId: string;
} {
  const separator = value.indexOf("/");
  const provider = value.slice(0, separator);
  const modelId = value.slice(separator + 1);

  if (separator <= 0 || !modelId) {
    throw new Error("Expected a provider-qualified model name, such as openai/gpt-5.");
  }

  if (!(provider in PROVIDER_SCHEMAS)) {
    throw new Error(
      `Unsupported provider "${provider}". Choose one of: ${Object.keys(PROVIDER_SCHEMAS).join(", ")}.`,
    );
  }

  return { provider: provider as keyof typeof PROVIDER_SCHEMAS, modelId };
}

export async function addModel(modelName: string, path = catalogPath): Promise<void> {
  const { provider, modelId } = parseModelName(modelName);
  const source = await readFile(path, "utf8");
  const schemaName = PROVIDER_SCHEMAS[provider];
  const catalogEntry = new RegExp(
    `(export const ${schemaName}ModelIdSchema = z\\n  \\.enum\\(\\[\\n)([\\s\\S]*?)(  \\]\\)\\n  \\.meta\\(\\{ id: "${schemaName}ModelId" \\}\\);)`,
  );
  const match = source.match(catalogEntry);

  if (!match) {
    throw new Error(`Could not find the ${provider} catalog entry.`);
  }

  const serializedModelId = JSON.stringify(modelId);
  if (match[2].includes(serializedModelId)) {
    throw new Error(`Model "${modelName}" is already cataloged.`);
  }

  const updated = source.replace(
    catalogEntry,
    (_match, start, entries, end) => `${start}${entries}    ${serializedModelId},\n${end}`,
  );
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
