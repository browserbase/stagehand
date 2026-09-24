#!/usr/bin/env node
import { config as loadDotenvConfig } from "dotenv";

// Loading the current directory's .env requires an explicit opt-in from the
// caller's environment. Existing explicit toggle values retain their behavior.
const dotenvToggle = process.env.BROWSE_LOAD_DOTENV;
const shouldLoadDotenv =
  dotenvToggle !== undefined &&
  !["0", "false", "no"].includes(dotenvToggle.toLowerCase());

if (shouldLoadDotenv) {
  loadDotenvConfig();
}

globalThis.oclif = {
  ...globalThis.oclif,
  enableAutoTranspile: false,
};

const { execute } = await import("@oclif/core");
await execute({ dir: import.meta.url });
