import "dotenv/config";
import { browserbase } from "../src/index.js";

const { BROWSERBASE_API_KEY } = process.env;
if (!BROWSERBASE_API_KEY) throw new Error("BROWSERBASE_API_KEY is required");

const fetchResult = await browserbase.fetch({
  apiKey: BROWSERBASE_API_KEY,
  url: "https://example.com",
  format: "markdown",
});

console.log(fetchResult.content);
