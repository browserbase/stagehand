import {
  type CollectionFlags,
  requireCollectionVersion,
  usesCollectionContract,
  validateCollectionFlags,
} from "../collections.js";
import { fail } from "../errors.js";
import { formatId, outputTable } from "../output.js";
import type { Secret } from "./api.js";

export function validateSecretsCollectionFlags(flags: CollectionFlags): void {
  if (usesCollectionContract(flags)) {
    validateCollectionFlags(flags);
    return;
  }
  requireCollectionVersion(flags, ["all", "format", "json", "wide"]);
  if (flags.limit !== undefined && flags.limit > 1000) {
    fail("--limit must be at most 1000 with --list-version 1.");
  }
}

export function outputSecretsTable(
  secrets: Secret[],
  flags: CollectionFlags,
): void {
  outputTable(
    secrets,
    [
      {
        header: "ID",
        maxWidth: 12,
        value: (secret) => formatId(secret.id, flags.wide),
      },
      { header: "Key", maxWidth: 48, value: (secret) => secret.secretKey },
    ],
    { wide: flags.wide },
  );
}
