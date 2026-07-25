import {
  resolveRemoteBrowserSource,
  type RemoteBrowserSourceResolverDependencies,
  type ResolvedBrowserSource,
} from "../../browserSource.shared.js";
import { StagehandClientInitParamsSchema } from "./clientSchemas.js";

export async function resolveBrowserSource(
  input: unknown,
  dependencies: RemoteBrowserSourceResolverDependencies = {},
): Promise<ResolvedBrowserSource> {
  const initParams = StagehandClientInitParamsSchema.parse(input);
  return resolveRemoteBrowserSource(initParams, dependencies);
}
