import "dotenv/config";
import { browserbase } from "../src/index.js";

const { BROWSERBASE_API_KEY } = process.env;
if (!BROWSERBASE_API_KEY) throw new Error("BROWSERBASE_API_KEY is required");

const searchResult = await browserbase.search({
  apiKey: BROWSERBASE_API_KEY,
  query: "browser agent frameworks",
  numResults: 5,
});

for (const result of searchResult.results) {
  console.log(`${result.title}: ${result.url}`);
}
