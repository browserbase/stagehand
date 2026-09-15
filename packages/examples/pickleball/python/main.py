"""Find, and optionally book, SF courts with Stagehand V4."""

import asyncio
import json
import os
from datetime import date, timedelta

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from stagehand import Stagehand, browserbase

load_dotenv()

BOOKING_URL = "https://www.rec.us/organizations/san-francisco-rec-park"


class Court(BaseModel):
    name: str = Field(min_length=1)
    opening_times: str = Field(description="Available or displayed time slots")
    location: str
    availability: str
    duration: str | None = None


class CourtResults(BaseModel):
    courts: list[Court]


class BookingConfirmation(BaseModel):
    confirmation_message: str | None = None
    booking_details: str | None = None
    error_message: str | None = None


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def requested_preferences() -> tuple[str, str, str]:
    activity = os.environ.get("ACTIVITY", "Pickleball")
    selected_date = os.environ.get("SELECTED_DATE", str(date.today() + timedelta(days=1)))
    time_of_day = os.environ.get("TIME_OF_DAY", "Evening")
    if activity not in {"Tennis", "Pickleball"}:
        raise RuntimeError("ACTIVITY must be Tennis or Pickleball")
    if time_of_day not in {"Morning", "Afternoon", "Evening"}:
        raise RuntimeError("TIME_OF_DAY must be Morning, Afternoon, or Evening")
    date.fromisoformat(selected_date)
    return activity, selected_date, time_of_day


async def login(stagehand: Stagehand, page: object) -> None:
    await stagehand.act("Click the Login button", page=page)
    await stagehand.act(
        "Fill the email or username field with %email%",
        page=page,
        variables={"email": require_env("SF_REC_PARK_EMAIL")},
    )
    await stagehand.act("Click the next, continue, or submit button", page=page)
    await stagehand.act(
        "Fill the password field with %password%",
        page=page,
        variables={"password": require_env("SF_REC_PARK_PASSWORD")},
    )
    await stagehand.act("Click the login, sign in, or submit button", page=page)


async def select_filters(
    stagehand: Stagehand,
    page: object,
    activity: str,
    selected_date: str,
    time_of_day: str,
) -> None:
    day_number = date.fromisoformat(selected_date).day
    await stagehand.act("Click the Activities dropdown", page=page)
    await stagehand.act(f"Select the {activity} activity", page=page)
    await stagehand.act("Click Done", page=page)
    await stagehand.act("Click the date picker or calendar", page=page)
    await stagehand.act(f"Click day {day_number} in the calendar", page=page)
    await stagehand.act("Click the time filter", page=page)
    await stagehand.act(f"Select the {time_of_day} time period", page=page)
    await stagehand.act("Click Done", page=page)
    await stagehand.act("Enable Available Only", page=page)
    await stagehand.act("Click the All Facilities dropdown", page=page)
    await stagehand.act("Select Accept Reservations", page=page)
    await stagehand.act("Click Done", page=page)


async def extract_courts(stagehand: Stagehand, page: object) -> list[Court]:
    extracted = await stagehand.extract(
        "Extract every displayed court option, its time slots, location, availability, and duration",
        CourtResults,
        page=page,
    )
    courts = extracted.data.courts
    if not courts:
        raise RuntimeError("The booking site returned no court availability information")
    return courts


async def book_first_court(stagehand: Stagehand, page: object) -> BookingConfirmation:
    await stagehand.act("Click the first available court time slot", page=page)
    await stagehand.act("Open the participant dropdown", page=page)
    await stagehand.act("Select the only named participant", page=page)
    await stagehand.act("Click the Book or Reserve button", page=page)
    await stagehand.act("Click Send Code", page=page)

    verification_code = input("Enter the one-time booking verification code: ").strip()
    if not verification_code:
        raise RuntimeError("A verification code is required to finish the reservation")
    await stagehand.act(
        "Fill the verification-code field with %code%",
        page=page,
        variables={"code": verification_code},
    )
    await stagehand.act("Click Confirm", page=page)
    extracted = await stagehand.extract(
        "Extract the booking confirmation, reservation details, and any error message",
        BookingConfirmation,
        page=page,
    )
    confirmation = extracted.data
    if confirmation.error_message:
        raise RuntimeError(f"Booking failed: {confirmation.error_message}")
    if not confirmation.confirmation_message and not confirmation.booking_details:
        raise RuntimeError("The site did not show a booking confirmation")
    return confirmation


async def main() -> None:
    activity, selected_date, time_of_day = requested_preferences()
    print(f"Finding {activity} courts for {time_of_day} on {selected_date}")

    browser = await browserbase.launch(
        api_key=require_env("BROWSERBASE_API_KEY"),
        timeout=900,
        region="us-west-2",
    )
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto(BOOKING_URL, wait_until="domcontentloaded", timeout=60_000)
            await login(stagehand, page)
            await select_filters(stagehand, page, activity, selected_date, time_of_day)
            courts = await extract_courts(stagehand, page)
            print("Live court availability:")
            print(json.dumps([court.model_dump(mode="json") for court in courts], indent=2))

            if os.environ.get("BOOK_COURT", "false").lower() == "true":
                confirmation = await book_first_court(stagehand, page)
                print("Booking confirmed:")
                print(json.dumps(confirmation.model_dump(mode="json"), indent=2))
            else:
                print("Set BOOK_COURT=true to reserve a court")
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Court workflow failed: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
