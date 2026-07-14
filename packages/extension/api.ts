// Compile-only shim: the hosted V3 API client is out of scope, but copied
// context/page constructors still carry this optional type.
import type { LoadState } from "../protocol/types.js";
import type { Response } from "./understudy/response.js";

export type StagehandAPIClient = {
  goto(
    url: string,
    options?: { waitUntil?: LoadState; timeout?: number },
    frameId?: string,
  ): Promise<Response | null>;
};
