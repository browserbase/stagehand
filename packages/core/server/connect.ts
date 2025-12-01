import { ConnectError, Code, type ConnectRouter } from "@connectrpc/connect";
import { StagehandPingService } from "../gen/stagehand/v1/ping_pb";
import { pingRequestSchema, pingResponseSchema } from "./schema/ping";

function ensureValidRequest(req: unknown) {
  const result = pingRequestSchema.safeParse(req);
  if (!result.success) {
    throw new ConnectError(
      `Invalid PingRequest: ${result.error.message}`,
      Code.InvalidArgument,
    );
  }
  return result.data;
}

function ensureValidResponse(data: unknown) {
  const result = pingResponseSchema.safeParse(data);
  if (!result.success) {
    throw new ConnectError(
      `Invalid PingResponse: ${result.error.message}`,
      Code.Internal,
    );
  }
  return result.data;
}

export default (router: ConnectRouter) =>
  router.service(StagehandPingService, {
    async ping(req) {
      const parsedReq = ensureValidRequest(req);
      const suffix = parsedReq.message ? `: ${parsedReq.message}` : "";
      return ensureValidResponse({ message: `pong${suffix}` });
    },
  });
