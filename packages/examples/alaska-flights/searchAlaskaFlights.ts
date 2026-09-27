import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import chalk from "chalk";
import dotenv from "dotenv";
import boxen from "boxen";

dotenv.config();

async function main() {
  // Set the origin and destination
  const origin = "SFO";
  const destination = "LAX";
  const departureDate = process.env.DEPARTURE_DATE;
  const returnDate = process.env.RETURN_DATE;
  if (!departureDate || !returnDate)
    throw new Error("Set DEPARTURE_DATE and RETURN_DATE (MM/DD/YYYY)");

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

  await stagehand.page.goto("https://www.alaskaair.com/");

  // Select the origin
  await page.act({ action: `type in starting location/origin: ${origin}` });
  await page.act({ action: `select ${origin} from the origin options` });

  // Select the destination
  await page.act({ action: `type in destination: ${destination}` });
  await page.act({ action: `select ${destination} from the destination options` });

  // Select the departure date
  await page.act({ action: `select ${departureDate} from the departure date options` });

  // Select the return date
  await page.act({ action: `select ${returnDate} from the return date options` });

  // Click the search for flights button
  await page.act({ action: "click search for flights" });

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

  await stagehand.close();
}

(async () => {
  await main();
  console.log(
    `\n🤘 Thanks for using Stagehand! Create an issue if you have any feedback: ${chalk.blue(
      "https://github.com/browserbase/stagehand/issues/new",
    )}\n`,
  );
})().catch(console.error);
