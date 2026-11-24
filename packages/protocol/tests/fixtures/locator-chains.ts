import { readFileSync } from "node:fs";
import type { LocatorChain } from "../../types.js";

const fixtures = JSON.parse(
  readFileSync(new URL("./locator-chain-wire.json", import.meta.url), "utf8"),
) as {
  valid: Array<{ name: string; chain: LocatorChain }>;
  invalid: Array<{ name: string; chain: unknown }>;
};
export const validLocatorChains = fixtures.valid;
export const invalidLocatorChains = fixtures.invalid;
