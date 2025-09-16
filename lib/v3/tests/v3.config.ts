import type { V3Options } from "@/lib/v3/types";
import type { LogLine } from "@/types/log";

export const v3TestConfig: V3Options = {
  env: "LOCAL",
  headless: true,
  verbose: 0,
  disablePino: true,
  logger: (line: LogLine) => console.log(line),
};

export function getV3TestConfig(overrides: Partial<V3Options> = {}): V3Options {
  return { ...v3TestConfig, ...overrides };
}

export default getV3TestConfig;
