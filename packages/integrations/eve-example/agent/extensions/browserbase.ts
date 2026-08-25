import browserbase from "@browserbasehq/eve";

export default browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY!,
});
