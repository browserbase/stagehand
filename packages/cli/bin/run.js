#!/usr/bin/env node
import "dotenv/config";

globalThis.oclif = {
  ...globalThis.oclif,
  enableAutoTranspile: false,
};

const { execute } = await import("@oclif/core");
await execute({ dir: import.meta.url });
