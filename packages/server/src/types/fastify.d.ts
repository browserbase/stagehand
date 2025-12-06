import "fastify";

import { LaunchDarklyClient } from "@browserbasehq/launchdarkly";

declare module "fastify" {
  interface FastifyInstance {
    launchdarkly: LaunchDarklyClient;
  }

  interface FastifyRequest {
    metrics: {
      startTime: number;
    };
  }
}
