import { Args } from "@oclif/core";
import { fail } from "../errors.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidArg(label: string, example: string) {
  return Args.string({
    description: `${label} (e.g. ${example}).`,
    required: true,
    parse: async (value) => {
      if (value.length !== 36 || !uuidPattern.test(value)) {
        fail(`${label} must be a UUID.`);
      }
      return value;
    },
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
