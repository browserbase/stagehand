import { LaunchDarklyClient } from "@browserbasehq/launchdarkly";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { env } from "./env.js";

export default fp(
  async (fastify: FastifyInstance) => {
    try {
      const sdkKey: string = env.LAUNCHDARKLY_SDK_KEY;
      const client = new LaunchDarklyClient(sdkKey, { logger: fastify.log });
      await client.initialize();

      fastify.decorate("launchdarkly", client);
      fastify.addHook("onClose", () => {
        client.close();
      });
    } catch (error: unknown) {
      fastify.log.error(error, "Failed to initialize LaunchDarkly client");
      throw error;
    }
  },
  { name: "bb-launchdarkly" },
);
