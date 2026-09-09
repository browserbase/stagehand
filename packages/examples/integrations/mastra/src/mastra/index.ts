import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { webAgent } from "./agents";

export const mastra = new Mastra({
  agents: { webAgent },
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
});
