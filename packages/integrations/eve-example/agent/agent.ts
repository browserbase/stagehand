import { openai } from "@ai-sdk/openai";
import { defineAgent } from "eve";
import dotenv from "dotenv";

dotenv.config();

export default defineAgent({
  model: openai(process.env.EVE_STAGEHAND_MODEL ?? "gpt-5.6-luna"),
});
