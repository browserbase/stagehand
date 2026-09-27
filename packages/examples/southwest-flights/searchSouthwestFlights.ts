import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import chalk from "chalk";
import dotenv from "dotenv";
import boxen from "boxen";

dotenv.config();

async function main() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE", // Environment to run in: LOCAL or BROWSERBASE
  });
  await stagehand.init();
  const page = stagehand.page;
  const context = stagehand.context;

  // Log your session recording in the terminal so you can see it
  console.log(
    boxen(
      `View this session recording in your browser: \n${chalk.blue(
        `https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`,
      )}`,
      {
        title: "Browserbase",
        padding: 1,
        margin: 3,
      },
    ),
  );
  // Set the origin and destination
  const origin = "SFO";
  const destination = "LAX";

  await page.goto("https://www.southwest.com/");
  await page.act("select the round trip option");
  await page.act(`type in origin: ${origin}`);
  await page.act(`select ${origin} from the origin menu options`);
  await page.act(`type in destination: ${destination}`);
  await page.act(`select ${destination} from the destination menu options`);
  await page.act("click the departure date of the first of next month");
  await page.act("click the return date of the eighth of the month");
  await page.act("click search for flights");
  await page.act("select only the non stop flights");

  // get array of flight data
  const flightData = await page.extract({
    instruction:
      "extract all of the flight data from the page, only include the flight number, departure and arrival times, and the price",
    schema: z.object({
      flights: z.array(
        z.object({
          flight_number: z.string(),
          departure_time: z.string(),
          arrival_time: z.string(),
          price: z.string(),
        }),
      ),
    }),
  });

  console.log(flightData);

  stagehand.close();
}

(async () => {
  await main();
  console.log(
    `\n🤘 Thanks for using Stagehand! Create an issue if you have any feedback: ${chalk.blue(
      "https://github.com/browserbase/stagehand/issues/new",
    )}\n`,
  );
})().catch(console.error);
