import { Stagehand } from "@/dist";

async function debug(url: string) {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    localBrowserLaunchOptions: {
      headless: true,
    },
  });
  await stagehand.init();
  await stagehand.page.goto(url);
}

(async () => {
  const url = process.argv.find((arg) => arg.startsWith("--url="));
  if (!url) {
    console.error("No URL flag provided. Usage: --url=https://example.com");
    process.exit(1);
  }
  const targetUrl = url.split("=")[1];
  console.log(`Navigating to: ${targetUrl}`);
  await debug(targetUrl);
})();
