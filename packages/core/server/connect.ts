import { ConnectError, Code, type ConnectRouter } from "@connectrpc/connect";
import { StagehandPingService } from "../gen/stagehand/v1/ping_pb";
import { pingRequestSchema } from "./schema/ping";

export default (router: ConnectRouter) =>
  router.service(StagehandPingService, {
    async ping(req) {
      const parsedReq = pingRequestSchema.safeParse(req);
      if (!parsedReq.success) {
        throw new ConnectError(
          `Invalid PingRequest: ${parsedReq.error.message}`,
          Code.InvalidArgument,
        );
      }
      const serverSendTime = BigInt(Date.now());
      return {
        clientSendTime: parsedReq.data.clientSendTime,
        serverSendTime,
      };
    },
  });
