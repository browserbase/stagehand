// SF Court Booking Automation - See README.md for full documentation
import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import inquirer from "inquirer";
import { z } from "zod/v4";

async function loginToSite(stagehand: Stagehand, email: string, password: string): Promise<void> {
  console.log("Logging in...");
  // Perform login sequence: each step is atomic to handle dynamic page changes.
  await stagehand.act("Click the Login button");
  await stagehand.act(`Fill in the email or username field with "${email}"`);
  await stagehand.act("Click the next, continue, or submit button to proceed");
  await stagehand.act(`Fill in the password field with "${password}"`);
  await stagehand.act("Click the login, sign in, or submit button");
  console.log("Logged in");
}

async function selectFilters(
  stagehand: Stagehand,
  activity: string,
  timeOfDay: string,
  selectedDate: string,
): Promise<void> {
  console.log("Selecting the activity");
  // Filter by activity type first to narrow down available courts.
  await stagehand.act(`Click the activites drop down menu`);
  await stagehand.act(`Select the ${activity} activity`);
  await stagehand.act(`Click the Done button`);

  console.log(`Selecting date: ${selectedDate}`);
  // Open calendar to select specific date for court booking.
  await stagehand.act(`Click the date picker or calendar`);

  // Parse date string to extract day number for calendar selection.
  const dateParts = selectedDate.split("-");
  if (dateParts.length !== 3) {
    throw new Error(`Invalid date format: ${selectedDate}. Expected YYYY-MM-DD`);
  }

  const dayNumber = parseInt(dateParts[2], 10);
  if (isNaN(dayNumber) || dayNumber < 1 || dayNumber > 31) {
    throw new Error(`Invalid day number: ${dayNumber} from date: ${selectedDate}`);
  }

  console.log(`Looking for day number: ${dayNumber} in calendar`);
  // Click specific day number in calendar to select date.
  await stagehand.act(`Click on the number ${dayNumber} in the calendar`);

  console.log(`Selecting time of day: ${timeOfDay}`);
  // Filter by time period to find courts available during preferred hours.
  await stagehand.act(`Click the time filter or time selection dropdown`);
  await stagehand.act(`Select ${timeOfDay} time period`);
  await stagehand.act(`Click the Done button`);

  // Apply additional filters to show only available courts that accept reservations.
  await stagehand.act(`Click Available Only button`);
  await stagehand.act(`Click All Facilities dropdown list`);
  await stagehand.act(`Select Accept Reservations checkbox`);
  await stagehand.act(`Click the Done button`);
}

async function checkAndExtractCourts(stagehand: Stagehand, timeOfDay: string): Promise<void> {
  console.log("Checking for available courts...");

  // First observe the page to find all available court booking options.
  const { data: availableCourts } = await stagehand.observe(
    "Find all available court booking slots, time slots, or court reservation options",
  );
  console.log(`Found ${availableCourts.length} available court options`);

  // Extract structured court data using Zod schema for type safety and validation.
  const { data: courtData } = await stagehand.extract(
    "Extract all available court booking information including court names, time slots, locations, and any other relevant details",
    z.object({
      courts: z.array(
        z.object({
          name: z.string().describe("the name or identifier of the court"),
          openingTimes: z.string().describe("the opening hours or operating times of the court"),
          location: z.string().describe("the location or facility name"),
          availability: z.string().describe("availability status or any restrictions"),
          duration: z.string().nullable().describe("the duration of the court session in minutes"),
        }),
      ),
    }),
  );

  // Check if any courts are actually available by filtering out unavailable status messages.
  let hasAvailableCourts = courtData.courts.some(
    (court: { availability: string }) =>
      !court.availability.toLowerCase().includes("no free spots") &&
      !court.availability.toLowerCase().includes("unavailable") &&
      !court.availability.toLowerCase().includes("next available") &&
      !court.availability.toLowerCase().includes("the next available reservation"),
  );

  // If no courts available for selected time, try alternative time periods as fallback.
  if (availableCourts.length === 0 || !hasAvailableCourts) {
    console.log("No courts available for selected time. Trying different time periods...");

    // Generate alternative time periods to try if original selection has no availability.
    const alternativeTimes =
      timeOfDay === "Morning"
        ? ["Afternoon", "Evening"]
        : timeOfDay === "Afternoon"
          ? ["Morning", "Evening"]
          : ["Morning", "Afternoon"];

    for (const altTime of alternativeTimes) {
      console.log(`Trying ${altTime} time period...`);

      // Change time filter to alternative time period and check availability.
      await stagehand.act(`Click the time filter dropdown that currently shows "${timeOfDay}"`);
      await stagehand.act(`Select ${altTime} from the time period options`);
      await stagehand.act(`Click the Done button`);

      const { data: altAvailableCourts } = await stagehand.observe(
        "Find all available court booking slots, time slots, or court reservation options",
      );
      console.log(`Found ${altAvailableCourts.length} available court options for ${altTime}`);

      if (altAvailableCourts.length > 0) {
        const { data: altCourtData } = await stagehand.extract(
          "Extract all available court booking information including court names, time slots, locations, and any other relevant details",
          z.object({
            courts: z.array(
              z.object({
                name: z.string().describe("the name or identifier of the court"),
                openingTimes: z
                  .string()
                  .describe("the opening hours or operating times of the court"),
                location: z.string().describe("the location or facility name"),
                availability: z.string().describe("availability status or any restrictions"),
                duration: z
                  .string()
                  .nullable()
                  .describe("the duration of the court session in minutes"),
              }),
            ),
          }),
        );

        const hasAltAvailableCourts = altCourtData.courts.some(
          (court: { availability: string }) =>
            !court.availability.toLowerCase().includes("no free spots") &&
            !court.availability.toLowerCase().includes("unavailable") &&
            !court.availability.toLowerCase().includes("next available") &&
            !court.availability.toLowerCase().includes("the next available reservation"),
        );

        // If alternative time has available courts, use that data and stop searching.
        if (hasAltAvailableCourts) {
          console.log(`Found actually available courts for ${altTime}!`);
          courtData.courts = altCourtData.courts;
          hasAvailableCourts = true;
          break;
        }
      }
    }
  }

  // If still no available courts found, extract final court data for display.
  if (!hasAvailableCourts) {
    console.log("Extracting final court information...");
    const { data: finalCourtData } = await stagehand.extract(
      "Extract all available court booking information including court names, time slots, locations, and any other relevant details",
      z.object({
        courts: z.array(
          z.object({
            name: z.string().describe("the name or identifier of the court"),
            openingTimes: z.string().describe("the opening hours or operating times of the court"),
            location: z.string().describe("the location or facility name"),
            availability: z.string().describe("availability status or any restrictions"),
            duration: z
              .string()
              .nullable()
              .describe("the duration of the court session in minutes"),
          }),
        ),
      }),
    );
    courtData.courts = finalCourtData.courts;
  }

  // Display all found court information to user for review and selection.
  console.log("Available Courts:");
  if (courtData.courts && courtData.courts.length > 0) {
    courtData.courts.forEach(
      (
        court: {
          name: string;
          openingTimes: string;
          location: string;
          availability: string;
          duration: string | null;
        },
        index: number,
      ) => {
        console.log(`${index + 1}. ${court.name}`);
        console.log(`   Opening Times: ${court.openingTimes}`);
        console.log(`   Location: ${court.location}`);
        console.log(`   Availability: ${court.availability}`);
        if (court.duration) {
          console.log(`   Duration: ${court.duration} minutes`);
        }
        console.log("");
      },
    );
  } else {
    console.log("No court data available to display");
  }
}

async function bookCourt(stagehand: Stagehand): Promise<void> {
  console.log("Starting court booking process...");

  try {
    // Select the first available court time slot for booking.
    console.log("Clicking the top available time slot...");
    await stagehand.act("Click the first available time slot or court booking option");

    // Select participant from dropdown - assumes only one participant is available.
    console.log("Opening participant dropdown...");
    await stagehand.act("Click the participant dropdown menu or select participant field");
    await stagehand.act("Click the only named participant in the dropdown!");

    // Complete booking process and trigger verification code request.
    console.log("Clicking the book button to complete reservation...");
    await stagehand.act("Click the book, reserve, or confirm booking button");
    await stagehand.act("Click the Send Code Button");

    // Prompt user for verification code received via SMS/email for booking confirmation.
    const codeAnswer = await inquirer.prompt([
      {
        type: "input",
        name: "verificationCode",
        message: "Please enter the verification code you received:",
        validate: (input: string) => {
          if (!input.trim()) {
            return "Please enter a verification code";
          }
          return true;
        },
      },
    ]);

    console.log(`Verification code: ${codeAnswer.verificationCode}`);

    // Enter verification code and confirm booking to complete reservation.
    await stagehand.act(
      `Fill in the verification code field with "${codeAnswer.verificationCode}"`,
    );
    await stagehand.act("Click the confirm button");

    // Extract booking confirmation details to verify successful reservation.
    console.log("Checking for booking confirmation...");
    const { data: confirmation } = await stagehand.extract(
      "Extract any booking confirmation message, success notification, or reservation details",
      z.object({
        confirmationMessage: z.string().nullable().describe("any confirmation or success message"),
        bookingDetails: z.string().nullable().describe("booking details like time, court, etc."),
        errorMessage: z.string().nullable().describe("any error message if booking failed"),
      }),
    );

    // Display confirmation details if booking was successful.
    if (confirmation.confirmationMessage || confirmation.bookingDetails) {
      console.log("Booking Confirmed!");
      if (confirmation.confirmationMessage) {
        console.log(`${confirmation.confirmationMessage}`);
      }
      if (confirmation.bookingDetails) {
        console.log(`${confirmation.bookingDetails}`);
      }
    }

    // Display error message if booking failed.
    if (confirmation.errorMessage) {
      console.log("Booking Error:");
      console.log(confirmation.errorMessage);
    }
  } catch (error) {
    console.error("Error during court booking:", error);
    throw error;
  }
}

async function selectActivity(): Promise<string> {
  // Prompt user to select between Tennis and Pickleball activities.
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "activity",
      message: "Please select an activity:",
      choices: [
        { name: "Tennis", value: "Tennis" },
        { name: "Pickleball", value: "Pickleball" },
      ],
      default: 0,
    },
  ]);

  console.log(`Selected: ${answers.activity}`);
  return answers.activity;
}

async function selectTimeOfDay(): Promise<string> {
  // Prompt user to select preferred time period for court booking.
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "timeOfDay",
      message: "Please select the time of day:",
      choices: [
        { name: "Morning (Before 12 PM)", value: "Morning" },
        { name: "Afternoon (After 12 PM)", value: "Afternoon" },
        { name: "Evening (After 5 PM)", value: "Evening" },
      ],
      default: 0,
    },
  ]);

  console.log(`Selected: ${answers.timeOfDay}`);
  return answers.timeOfDay;
}

async function selectDate(): Promise<string> {
  // Generate date options for the next 7 days including today.
  const today = new Date();
  const dateOptions: { name: string; value: string }[] = [];

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
    const monthDay = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const fullDate = date.toISOString().split("T")[0];

    const displayName = i === 0 ? `${dayName}, ${monthDay} (Today)` : `${dayName}, ${monthDay}`;

    dateOptions.push({
      name: displayName,
      value: fullDate,
    });
  }

  // Prompt user to select from available date options.
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "selectedDate",
      message: "Please select a date:",
      choices: dateOptions,
      default: 0,
    },
  ]);

  // Format selected date for display and return ISO date string.
  const selectedDate = new Date(answers.selectedDate);
  const displayDate = selectedDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  console.log(`Selected: ${displayDate}`);
  return answers.selectedDate;
}

async function bookTennisPaddleCourt() {
  console.log("Starting tennis/paddle court booking automation in SF...");

  // Load credentials from environment variables for SF Rec & Parks login.
  const email = process.env.SF_REC_PARK_EMAIL;
  const password = process.env.SF_REC_PARK_PASSWORD;
  const _debugMode = process.env.DEBUG === "true";

  // Collect user preferences for activity, date, and time selection.
  const activity = await selectActivity();
  const selectedDate = await selectDate();
  const timeOfDay = await selectTimeOfDay();

  console.log(`Booking ${activity} courts in San Francisco for ${timeOfDay} on ${selectedDate}...`);

  // Validate that required credentials are available before proceeding.
  if (!email || !password) {
    throw new Error("Missing SF_REC_PARK_EMAIL or SF_REC_PARK_PASSWORD environment variables");
  }

  // Initialize Stagehand with Browserbase for AI-powered browser automation.
  console.log("Initializing Stagehand with Browserbase");
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
    api_timeout: 900,
    region: "us-west-2",
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "openai/gpt-4.1" },
    logging: { level: "info" },
  });

  try {
    // Start browser session and connect to SF Rec & Parks booking system.

    console.log("Browserbase Session Started");
    const page = (await browser.context.pages())[0];

    // Navigate to SF Rec & Parks booking site with extended timeout for slow loading.
    console.log("Navigating to court booking site...");
    await page.goto("https://www.rec.us/organizations/san-francisco-rec-park", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Execute booking workflow: login, filter, find courts, and complete booking.
    await loginToSite(stagehand, email, password);
    await selectFilters(stagehand, activity, timeOfDay, selectedDate);
    await checkAndExtractCourts(stagehand, timeOfDay);
    await bookCourt(stagehand);
  } catch (error) {
    console.error("Error during court booking:", error);
    throw error;
  } finally {
    // Always close browser session to release resources and clean up.
    await stagehand.close();
    await browser.close();
    console.log("\nBrowser session closed");
  }
}

async function main() {
  // Display welcome message and explain the automation workflow to user.
  console.log("Welcome to SF Court Booking Automation!");
  console.log("");
  console.log("This tool automates tennis and pickleball court bookings in San Francisco.");
  console.log("Here's what we'll do:");
  console.log("");
  console.log("1. Navigate to https://www.rec.us/organizations/san-francisco-rec-park");
  console.log("2. Use automated login with your credentials");
  console.log("3. Select your preferred activity, date, and time");
  console.log("4. Find and book available courts automatically");
  console.log("5. Handle verification codes and confirmation");
  console.log("");

  try {
    // Execute the complete court booking automation workflow.
    await bookTennisPaddleCourt();

    console.log("Court booking completed successfully!");
    console.log("Your court has been reserved. Check your email for confirmation details.");
  } catch (error) {
    console.log("Failed to complete court booking");
    console.log(`Error: ${error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Application error:", err);
  console.log("Check your environment variables");
  process.exit(1);
});
