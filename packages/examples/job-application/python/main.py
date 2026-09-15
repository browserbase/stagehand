"""Discover and submit test applications with Stagehand V4."""

import asyncio
import os
import random
import string
import time

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, Field, HttpUrl

from stagehand import FilePayload, Stagehand, browserbase

load_dotenv()

JOB_BOARD_URL = "https://agent-job-board.vercel.app/"
RESUME_URL = f"{JOB_BOARD_URL}Agent%20Resume.pdf"


class JobInfo(BaseModel):
    url: HttpUrl = Field(description="Job URL")
    title: str = Field(min_length=1, description="Job title")


class JobsData(BaseModel):
    jobs: list[JobInfo]


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def generate_random_email() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"agent-{suffix}@example.com"


def generate_agent_id() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=7))
    return f"agent-{int(time.time() * 1000)}-{suffix}"


async def close_session(stagehand: Stagehand, browser: object) -> None:
    await stagehand.close()
    await browser.close()  # type: ignore[attr-defined]


async def discover_jobs() -> list[JobInfo]:
    browser = await browserbase.launch(api_key=require_env("BROWSERBASE_API_KEY"))
    stagehand = await Stagehand.create(
        browser=browser,
    )
    try:
        pages = await browser.context.pages()
        page = pages[0] if pages else await browser.context.new_page()
        await page.goto(JOB_BOARD_URL, wait_until="domcontentloaded", timeout=60_000)
        await stagehand.act("Click the View Jobs button", page=page)
        extracted = await stagehand.extract(
            "Extract every visible job listing with its title and absolute URL",
            JobsData,
            page=page,
        )
        jobs = extracted.data.jobs
        if not jobs:
            raise RuntimeError("The job board returned no job listings")
        return jobs
    finally:
        await close_session(stagehand, browser)


async def apply_to_job(job: JobInfo, resume: bytes, semaphore: asyncio.Semaphore) -> str:
    async with semaphore:
        browser = await browserbase.launch(api_key=require_env("BROWSERBASE_API_KEY"))
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto(str(job.url), wait_until="domcontentloaded", timeout=60_000)
            await stagehand.act(f"Click the job listing titled {job.title}", page=page)

            agent_id = generate_agent_id()
            email = generate_random_email()
            await stagehand.act(
                "Fill the agent identifier field with %agent_id%",
                page=page,
                variables={"agent_id": agent_id},
            )
            await stagehand.act(
                "Fill the contact endpoint field with %email%",
                page=page,
                variables={"email": email},
            )
            await stagehand.act("Fill the deployment region field with us-west-2", page=page)

            observed = await stagehand.observe(
                "Find the file input for the agent profile or resume",
                page=page,
            )
            if not observed.data or not observed.data[0].selector:
                raise RuntimeError(f"[{job.title}] Could not locate the resume upload input")
            await page.locator(observed.data[0].selector).set_input_files(
                FilePayload(
                    name="Agent Resume.pdf",
                    buffer=resume,
                    mime_type="application/pdf",
                )
            )

            await stagehand.act("Select Yes for multi-region deployment", page=page)
            await stagehand.act("Click the Deploy Agent button", page=page)
            print(f"[{job.title}] Application submitted ({agent_id}, {email})")
            return job.title
        finally:
            await close_session(stagehand, browser)


async def main() -> None:
    max_concurrency = max(1, int(os.environ.get("MAX_CONCURRENCY", "2")))
    max_jobs = int(os.environ.get("MAX_JOBS", "0"))
    jobs = await discover_jobs()
    if max_jobs > 0:
        jobs = jobs[:max_jobs]
    print(f"Discovered {len(jobs)} jobs; applying with concurrency {max_concurrency}")

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        response = await client.get(RESUME_URL)
        response.raise_for_status()
        resume = response.content
    if not resume.startswith(b"%PDF"):
        raise RuntimeError("The resume download was not a PDF")

    semaphore = asyncio.Semaphore(max_concurrency)
    results = await asyncio.gather(
        *(apply_to_job(job, resume, semaphore) for job in jobs),
        return_exceptions=True,
    )
    failures = [result for result in results if isinstance(result, BaseException)]
    if failures:
        raise RuntimeError(f"{len(failures)} of {len(jobs)} applications failed: {failures}")
    print(f"Completed {len(results)} job application submissions")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Job application automation failed: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
