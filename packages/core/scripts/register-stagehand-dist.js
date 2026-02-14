/**
 * Module loader hook to resolve Stagehand imports to dist/esm.
 *
 * Prereqs: packages/core/dist/esm exists.
 * Args: none (used via node --import).
 * Env: none.
 * Example: node --import ./packages/core/scripts/register-stagehand-dist.js ...
 */
import { register } from "node:module";

register(new URL("./resolve-stagehand-dist.js", import.meta.url));
