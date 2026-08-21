import { writeFile } from "node:fs/promises";

const recordPath = process.argv[2];
if (!recordPath) throw new Error("record-env fixture requires an output path");

await writeFile(
  recordPath,
  JSON.stringify({
    STAGEHAND_BROWSER: process.env.STAGEHAND_BROWSER,
    BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    OTHER_SECRET: process.env.OTHER_SECRET,
  }),
);
