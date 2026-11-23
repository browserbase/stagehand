import { functionsRequest, resolveFunctionsApiConfig } from "./shared.js";

export interface DeleteFunctionOptions {
  apiKey?: string;
  baseUrl?: string;
  functionId: string;
}

export interface DeleteFunctionResponse {
  deleted: boolean;
}

export async function deleteFunction(
  options: DeleteFunctionOptions,
): Promise<DeleteFunctionResponse> {
  const config = resolveFunctionsApiConfig(options);
  const response = await functionsRequest(
    config,
    `/v1/functions/${encodeURIComponent(options.functionId)}`,
    { method: "DELETE" },
  );
  const result = (await response.json()) as DeleteFunctionResponse;
  console.log(JSON.stringify(result, null, 2));
  return result;
}
