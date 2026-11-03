# Durable order approval with Pydantic AI

Draft a fictional order, pause for human approval, and submit through Stagehand. This independent Python CLI uses Pydantic AI, DBOS with SQLite, and Browserbase.

## Install and run

Follow the [Python setup](../README.md#python), then run from the repository root:

```bash
just install
cp packages/examples/cookbooks/pydantic-ai-durable-approval/python/.env.example packages/examples/cookbooks/pydantic-ai-durable-approval/python/.env
```

Set `OPENAI_API_KEY` and `BROWSERBASE_API_KEY` in the copied file. OpenAI drafts the order. Stagehand uses locators to fill and check the form and does not need a browser model.

```bash
just cookbook-python pydantic-ai-durable-approval
```

In another terminal at the repository root, set `RUN_ID` to the printed workflow ID. Review the saved values:

```bash
just cookbook-python pydantic-ai-durable-approval status "$RUN_ID"
```

`progress.phase` and `progress.nextAction` come from the saved workflow. Status does not call a model or reconnect the browser. Once the proposal appears, press Ctrl+C in the worker terminal to simulate worker loss. Send a decision and restart with the same ID:

```bash
just cookbook-python pydantic-ai-durable-approval approve "$RUN_ID"
just cookbook-python pydantic-ai-durable-approval resume "$RUN_ID"
just cookbook-python pydantic-ai-durable-approval cleanup "$RUN_ID"
```

Use `reject` to finish without opening a browser. The workflow waits up to one hour and accepts the first decision. The status and decision commands read and write SQLite directly, so they also work while the worker is stopped. `cleanup` releases the Browserbase session and retains history. After the initial build, you can run any command from this recipe's `python/` directory with `uv run --locked python main.py <command> <id>`.

## Follow the code

1. `order_workflow` uses Pydantic AI to draft a structured order. It publishes the exact form fields, including a run reference, and waits for the human decision in DBOS.
2. `submit` opens the [httpbin test form](https://httpbin.org/forms/post) only after approval. `Stagehand.create` attaches the browser, then locators fill the form and `page.evaluate` checks the actual values.
3. The step writes the Browserbase session ID to a per-run marker before clicking. A replay that finds the marker only checks the receipt.
4. The browser connection uses `disconnect()` so the keep-alive session remains. `cleanup` connects again and `close()` releases it.

## Why durability matters

DBOS journals the model request and the approval wait. The workflow can leave and come back on the same SQLite database. The marker is the record that a click was authorized. Replaying the step must not authorize another click. A matching httpbin response is the only success signal. A missing or different response is an unknown outcome, not a successful order. No money moves.

## Browser operations

Pydantic AI chooses the customer name and delivery note. Stagehand locators fill the known form, and `page.evaluate` reads every actual field. The recipe clicks Submit only after that check and the marker write. Deterministic parsing checks the echoed response.

Use the printed Browserbase session link to inspect execution. These checks use the DOM. Screenshots are optional visual evidence. They do not replace the saved proposal, the marker, or the receipt comparison.

## Recovery and limits

The browser opens after approval and lasts up to 30 minutes. Approval itself does not hold a browser open. Resume promptly after a submit crash. Run one worker at a time against the recipe's local SQLite database. Keep the database and submission markers in `python/out/` together. A crash between saving the marker and clicking can leave an unknown outcome even if the click never happened.

`browser.close()` releases a Browserbase session even when it was opened with `keep_alive=True`. This recipe disconnects after a recorded attempt and releases the session only from `cleanup`. Ctrl+C exits without DBOS teardown so the waiting workflow stays resumable.

## Manual browser check

For a fresh approved run, interrupt the worker at the submit boundary. Remove any `CRASH_AFTER_SUBMIT=1` setting from `.env` before the second resume:

```bash
CRASH_AFTER_SUBMIT=1 just cookbook-python pydantic-ai-durable-approval resume "$RUN_ID"
just cookbook-python pydantic-ai-durable-approval resume "$RUN_ID"
just cookbook-python pydantic-ai-durable-approval status "$RUN_ID"
just cookbook-python pydantic-ai-durable-approval cleanup "$RUN_ID"
```

Expect a matching receipt or an unknown outcome if the response is missing, different, or the session has expired. The second resume must not click Submit again. Check rejection separately with a new workflow ID.

See the [cookbook docs](https://docs.stagehand.dev/v4/cookbooks/pydantic-ai-durable-approval) for the agent prompt and the [Pydantic AI DBOS guide](https://pydantic.dev/docs/ai/capabilities/durable_execution/dbos/) for deployment options.
