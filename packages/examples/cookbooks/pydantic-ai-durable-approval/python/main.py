import argparse
import asyncio
import json
import logging
import os
from pathlib import Path
from uuid import UUID, uuid4

from dbos import DBOS, DBOSClient, SetWorkflowID
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.durable_exec.dbos import DBOSDurability
from stagehand import BrowserbaseBrowserSettings, Page, Stagehand, browserbase

load_dotenv()

FORM_URL = "https://httpbin.org/forms/post"
RECEIPT_URL = "https://httpbin.org/post"
OUT = Path(__file__).resolve().parent / "out"
DATABASE = f"sqlite:///{OUT / 'workflow.sqlite'}"
UNKNOWN = (
    "Submission outcome unknown. Inspect the session before taking further action."
)

FORM_VALUES = """(() => {
  if (location.origin !== "https://httpbin.org") throw new Error("Unexpected form origin");
  const form = document.querySelector("form");
  if (!form || new URL(form.action).href !== "https://httpbin.org/post") {
    throw new Error("Unexpected form action");
  }
  const values = {};
  for (const key of new Set(new FormData(form).keys())) {
    values[key] = JSON.stringify(new FormData(form).getAll(key));
  }
  return values;
})()"""

DEFAULT_MODEL = "openai:gpt-5.6-sol"


class Order(BaseModel):
    customer: str = Field(min_length=1, max_length=80)
    comments: str = Field(min_length=1, max_length=160)


agent = Agent(
    DEFAULT_MODEL,
    name="cookbook-order",
    output_type=Order,
    instructions=(
        "Draft a fictional test order. Use a fictional customer and a short delivery note."
    ),
    capabilities=[DBOSDurability()],
)


def encoded(values: dict[str, str]) -> dict[str, str]:
    return {
        key: json.dumps([value], ensure_ascii=False, separators=(",", ":"))
        for key, value in values.items()
    }


def form_values(run_id: str, order: Order) -> dict[str, str]:
    return {
        "custname": order.customer,
        "custemail": "demo@example.com",
        "custtel": "",
        "size": "medium",
        "delivery": "",
        "comments": f"{' '.join(order.comments.split())} [run:{run_id}]",
    }


def claim_marker(path: Path, session_id: str) -> None:
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w") as file:
        file.write(session_id)
        file.flush()
        os.fsync(file.fileno())


def recorded_session(run_id: str) -> str | None:
    marker = OUT / f"{run_id}.submission"
    if not marker.exists():
        return None
    return marker.read_text().strip()


def verified(session_id: str) -> str:
    return f"Verified receipt in session {session_id}"


def progress(
    run_id: str, status: str, proposal: object, attempted: bool, result: str | None
) -> dict[str, str]:
    resume = f"just cookbook-python pydantic-ai-durable-approval resume {run_id}"
    cleanup = f"just cookbook-python pydantic-ai-durable-approval cleanup {run_id}"
    approve = f"just cookbook-python pydantic-ai-durable-approval approve {run_id}"
    if result is not None and result.startswith("Verified receipt"):
        return {
            "phase": "confirmed",
            "nextAction": f"Run {cleanup} to release the browser. History stays in python/out/.",
        }
    if result is not None and "unknown" in result.lower():
        return {
            "phase": "outcome_unknown",
            "nextAction": (
                "Inspect the saved session manually. Submission will not be repeated. "
                f"Then run {cleanup}."
            ),
        }
    if attempted:
        return {
            "phase": "outcome_unknown",
            "nextAction": (
                "If the worker has exited, run "
                f"{resume} to check the receipt. Do not start a second worker. "
                "Submission will not be repeated."
            ),
        }
    if result is not None and result.startswith("Rejected"):
        return {
            "phase": "rejected",
            "nextAction": "Nothing was submitted. The decision is saved in python/out/.",
        }
    if proposal is not None and status == "PENDING":
        reject = f"just cookbook-python pydantic-ai-durable-approval reject {run_id}"
        return {
            "phase": "awaiting_approval",
            "nextAction": f"Review the proposal. Run {approve} or {reject}, then {resume}.",
        }
    if status == "PENDING":
        return {
            "phase": "preparing",
            "nextAction": f"Run {resume} to continue drafting the order.",
        }
    return {
        "phase": "stopped",
        "nextAction": f"Inspect the workflow status. Resume with {resume} only if it is unfinished.",
    }


async def receipt_matches(page: Page, expected: dict[str, str]) -> bool:
    try:
        if not await page.wait_for_selector("pre", timeout=15_000):
            return False
        if await page.url() != RECEIPT_URL:
            return False
        receipt = json.loads(await page.locator("pre").inner_text())
    except (json.JSONDecodeError, ValueError, RuntimeError):
        return False
    form = receipt.get("form") if isinstance(receipt, dict) else None
    if not isinstance(form, dict):
        return False
    actual = {
        key: json.dumps(
            value if isinstance(value, list) else [value],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        for key, value in form.items()
    }
    return actual == encoded(expected)


async def finish_browser(browser, stagehand: Stagehand | None, *, keep: bool) -> None:
    if keep:
        # disconnect leaves a keep-alive Browserbase session for a later check.
        # close() would release it, including a session opened with keep_alive=True.
        await browser.disconnect()
        return
    try:
        if stagehand is not None:
            await stagehand.close()
    finally:
        await browser.close()


async def prepare_form(page: Page, expected: dict[str, str]) -> None:
    await page.goto(FORM_URL)
    if await page.url() != FORM_URL:
        raise RuntimeError("Unexpected form URL")
    await page.locator('input[name="custname"]').fill(expected["custname"])
    await page.locator('input[name="custemail"]').fill(expected["custemail"])
    await page.locator('input[name="size"][value="medium"]').click()
    await page.locator('textarea[name="comments"]').fill(expected["comments"])
    actual = await page.evaluate(FORM_VALUES)
    if actual != encoded(expected):
        raise RuntimeError("Browser form does not match the approved order")


@DBOS.step()
async def submit(run_id: str, expected: dict[str, str]) -> str:
    api_key = os.environ["BROWSERBASE_API_KEY"]
    OUT.mkdir(exist_ok=True)
    session_id = recorded_session(run_id)
    if session_id == "":
        return UNKNOWN

    if session_id:
        try:
            browser = await browserbase.connect(api_key=api_key, session_id=session_id)
        except Exception:
            logging.exception("Could not reconnect to session %s", session_id)
            return UNKNOWN
    else:
        browser = await browserbase.launch(
            api_key=api_key,
            keep_alive=True,
            timeout=1800,
            browser_settings=BrowserbaseBrowserSettings(solve_captchas=False),
        )
    stagehand: Stagehand | None = None
    # A recorded session, or a marker written below, must survive this process.
    keep = session_id is not None
    try:
        if session_id is None:
            print(
                f"Session: https://www.browserbase.com/sessions/{browser.session_id}",
                flush=True,
            )
        stagehand = await Stagehand.create(browser=browser)
        page = await browser.context.active_page()
        if page is None:
            raise RuntimeError("No active page")
        if session_id:
            if await receipt_matches(page, expected):
                return verified(session_id)
            return UNKNOWN

        await prepare_form(page, expected)
        if not browser.session_id:
            raise RuntimeError("Browserbase session ID is missing")
        # DBOS may replay a step interrupted during the click. Only the process
        # that creates this marker is allowed to submit.
        try:
            claim_marker(OUT / f"{run_id}.submission", browser.session_id)
        except FileExistsError:
            return UNKNOWN
        keep = True
        try:
            await page.locator("button").click()
        except Exception:
            logging.exception(
                "Could not confirm the click in session %s", browser.session_id
            )
        else:
            if os.getenv("CRASH_AFTER_SUBMIT") == "1":
                os._exit(79)
        if await receipt_matches(page, expected):
            return verified(browser.session_id)
        return UNKNOWN
    finally:
        await finish_browser(browser, stagehand, keep=keep)


@DBOS.workflow()
async def order_workflow(run_id: str, model: str) -> str:
    result = await agent.run("Draft a medium test order for delivery.", model=model)
    expected = form_values(run_id, result.output)
    await DBOS.set_event_async("proposal", expected)
    approved = await DBOS.recv_async("decision", timeout_seconds=3600)
    if approved is not True:
        return "Rejected or expired. No browser was opened."
    return await submit(run_id, expected)


async def release_session(run_id: str) -> None:
    session_id = recorded_session(run_id)
    if not session_id:
        print("No browser session to release.")
        return
    try:
        browser = await browserbase.connect(
            api_key=os.environ["BROWSERBASE_API_KEY"], session_id=session_id
        )
        await browser.close()
    except Exception:
        logging.exception("Could not release session %s", session_id)
        print("Could not release the session. Durable history was retained.")
        return
    print("Browser released; durable history retained.")


def workflow_summary(run_id: str, client: DBOSClient) -> None:
    handle = client.retrieve_workflow(run_id)
    status = handle.get_status().status
    status_name = status.value if hasattr(status, "value") else str(status)
    proposal = client.get_event(run_id, "proposal", timeout_seconds=0)
    result = handle.get_result() if status_name == "SUCCESS" else None
    attempted = recorded_session(run_id) is not None
    summary = {
        "status": status_name,
        "proposal": proposal,
        "attempted": attempted,
        "progress": progress(run_id, status_name, proposal, attempted, result),
    }
    if result is not None:
        summary["result"] = result
    print(json.dumps(summary, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Draft and approve a durable test order."
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="start",
        choices=["start", "resume", "status", "approve", "reject", "cleanup"],
    )
    parser.add_argument("id", nargs="?", type=UUID)
    args = parser.parse_args()
    if args.id is None and args.command != "start":
        parser.error(f"{args.command} requires a workflow ID.")
    run_id = str(args.id or uuid4())

    if args.command == "cleanup":
        asyncio.run(release_session(run_id))
        return

    if args.command in {"status", "approve", "reject"}:
        if not (OUT / "workflow.sqlite").exists():
            parser.error("Start a workflow first.")
        client = DBOSClient(system_database_url=DATABASE)
        try:
            if args.command != "status":
                handle = client.retrieve_workflow(run_id)
                status = handle.get_status().status
                status_name = status.value if hasattr(status, "value") else str(status)
                proposal = client.get_event(run_id, "proposal", timeout_seconds=0)
                if proposal is None or status_name != "PENDING":
                    parser.error("This workflow has no pending proposal.")
                client.send(
                    run_id,
                    args.command == "approve",
                    "decision",
                    idempotency_key=run_id,
                )
            workflow_summary(run_id, client)
        finally:
            client.destroy()
        return

    OUT.mkdir(exist_ok=True)
    DBOS(config={"name": "stagehand-durable-order", "system_database_url": DATABASE})
    DBOS.launch()
    try:
        if args.command == "start":
            with SetWorkflowID(run_id):
                handle = DBOS.start_workflow(
                    order_workflow, run_id, os.getenv("AGENT_MODEL", DEFAULT_MODEL)
                )
        else:
            handle = DBOS.retrieve_workflow(run_id)
        print(f"Workflow: {run_id}", flush=True)
        print(handle.get_result())
    except KeyboardInterrupt:
        # Simulate worker loss. DBOS teardown cancels active runs and records an error.
        os._exit(130)
    finally:
        DBOS.destroy()


if __name__ == "__main__":
    main()
