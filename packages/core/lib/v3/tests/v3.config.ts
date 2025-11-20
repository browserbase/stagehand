import type { V3Options } from "../types/public/options";
import type { LogLine } from "../types/public/logs";

export const v3TestConfig: V3Options = {
  env: "LOCAL",
  localBrowserLaunchOptions: {
    headless: true,
    viewport: { width: 1288, height: 711 },
  },
  selfHeal: false,
  verbose: 0,
  disablePino: true,
  logger: (line: LogLine) => console.log(line),
};

export function getV3TestConfig(overrides: Partial<V3Options> = {}): V3Options {
  return { ...v3TestConfig, ...overrides };
}

export default getV3TestConfig;
