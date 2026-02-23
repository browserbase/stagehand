import type { V3Options } from "../../lib/v3/types/public/options.js";
import {
  v3DynamicTestConfig,
  getV3DynamicTestConfig,
} from "./v3.dynamic.config.js";

export const v3TestConfig: V3Options = v3DynamicTestConfig;

export function getV3TestConfig(overrides: Partial<V3Options> = {}): V3Options {
  return getV3DynamicTestConfig(overrides);
}

export default getV3TestConfig;
