import { Args } from "@oclif/core";
import { parseUuid } from "./ids.js";

function uuidArg(label: string, example?: string) {
  return Args.string({
    description: example ? `${label} (e.g. ${example}).` : `${label}.`,
    required: true,
    parse: async (value) => parseUuid(value, label),
  });
}

export const secretIdArg = uuidArg(
  "Project secret ID",
  "d2c4f48f-38e9-4b82-a36a-2b373fd14a65",
);

export const functionIdArg = uuidArg(
  "Function ID",
  "7b6e1c42-8d93-4a15-b2f0-9c6d3e8a5041",
);

export const projectIdArg = uuidArg("Project ID");
export const sessionIdArg = uuidArg("Session ID");
export const extensionIdArg = uuidArg("Extension ID");
