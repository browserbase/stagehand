"""Complete a live RFC 6238 TOTP challenge with Stagehand V4."""

import asyncio
import base64
import hashlib
import hmac
import os
import struct
import time

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from stagehand import Page, Stagehand, browserbase

load_dotenv()

DEMO_URL = "https://authenticationtest.com/totpChallenge/"


class Credentials(BaseModel):
    email: str
    password: str
    totp_secret: str = Field(description="TOTP secret key shown by the demo")


class AuthResult(BaseModel):
    success: bool
    message: str


def generate_totp(secret: str, window: int = 0) -> str:
    normalized = secret.upper().replace(" ", "").rstrip("=")
    padding = "=" * ((8 - len(normalized) % 8) % 8)
    key = base64.b32decode(normalized + padding)
    counter = int(time.time() // 30) + window
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % 1_000_000).zfill(6)


async def submit(stagehand: Stagehand, page: Page, credentials: Credentials) -> None:
    await stagehand.act(
        "Fill the email field with %email%",
        page=page,
        variables={"email": credentials.email},
    )
    await stagehand.act(
        "Fill the password field with %password%",
        page=page,
        variables={"password": credentials.password},
    )
    seconds_left = 30 - int(time.time()) % 30
    if seconds_left < 12:
        await asyncio.sleep(seconds_left + 1)
    code = generate_totp(credentials.totp_secret)
    await stagehand.act(
        "Fill the TOTP code field with %code%",
        page=page,
        variables={"code": code},
    )
    await stagehand.act("Click the submit or login button", page=page)


async def main() -> None:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    browser = await browserbase.launch(api_key=api_key)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto(DEMO_URL, wait_until="domcontentloaded", timeout=60_000)
            extracted = await stagehand.extract(
                "Extract the test email, password, and TOTP secret shown on the page",
                Credentials,
                page=page,
            )
            credentials = extracted.data
            await submit(stagehand, page, credentials)
            await page.wait_for_timeout(1_000)
            result = await stagehand.extract(
                "Check whether the TOTP login succeeded and return its message",
                AuthResult,
                page=page,
            )
            if not result.data.success:
                await page.goto(DEMO_URL, wait_until="domcontentloaded")
                await submit(stagehand, page, credentials)
                await page.wait_for_timeout(1_000)
                result = await stagehand.extract(
                    "Check whether the TOTP login succeeded and return its message",
                    AuthResult,
                    page=page,
                )
            if not result.data.success:
                raise RuntimeError(f"TOTP authentication failed: {result.data.message}")
            print(f"TOTP authentication succeeded: {result.data.message}")
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        print("Session closed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"TOTP example failed: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
