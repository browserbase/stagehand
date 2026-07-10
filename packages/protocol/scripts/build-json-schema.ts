import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { STAGEHAND_PROTOCOL_VERSION, StagehandProtocolSchema } from "../events.ts";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaDir = path.join(packageDir, "schema");
const schemaPath = path.join(schemaDir, `${STAGEHAND_PROTOCOL_VERSION}.json`);

const convertedSchema = replaceConstWithEnum(z.toJSONSchema(StagehandProtocolSchema));

const schema = {
  ...convertedSchema,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `https://stagehand.dev/schema/${STAGEHAND_PROTOCOL_VERSION}.json`,
  title: "Stagehand V4 Protocol",
};

await mkdir(schemaDir, { recursive: true });
await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");

function replaceConstWithEnum(value: unknown): Record<string, unknown> {
  const rewritten = replaceConstWithEnumValue(value);
  if (!rewritten || typeof rewritten !== "object" || Array.isArray(rewritten)) {
    throw new TypeError("Expected Zod to emit a JSON Schema object");
  }
  return rewritten as Record<string, unknown>;
}

function replaceConstWithEnumValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(replaceConstWithEnumValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const rewritten: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "const") {
      rewritten.enum = [replaceConstWithEnumValue(child)];
      continue;
    }
    rewritten[key] = replaceConstWithEnumValue(child);
  }
  return rewritten;
}
