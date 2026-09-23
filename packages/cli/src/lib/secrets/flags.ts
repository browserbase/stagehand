import { Flags } from "@oclif/core";
import type { ListSecretsOptions } from "./api.js";

export const listSecretsFlags = {
  limit: Flags.integer({
    min: 1,
    max: 1000,
    description: "Maximum results per page (API default: 20).",
  }),
  cursor: Flags.string({
    description: "nextCursor from the previous page. Keep the same filters.",
  }),
  "start-at": Flags.string({
    description: "Include secrets created on or after this RFC 3339 timestamp.",
  }),
  "end-at": Flags.string({
    description:
      "Include secrets created on or before this RFC 3339 timestamp.",
  }),
};

export function toListSecretsOptions(flags: {
  limit?: number;
  cursor?: string;
  "start-at"?: string;
  "end-at"?: string;
}): ListSecretsOptions {
  return {
    limit: flags.limit,
    cursor: flags.cursor,
    startAt: flags["start-at"],
    endAt: flags["end-at"],
  };
}
