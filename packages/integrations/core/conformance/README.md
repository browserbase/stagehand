# Facade conformance cases

Every facade host (the TypeScript `StagehandFacadeTools`, and hosts in other
languages built on `dist/facade-bundle.json`) must pass every applicable case
in `cases/`: every case except those `notApplicable` marks for that host.
The cases drive a host against a fake Stagehand, so they check what the host
does with batch results, snapshots and the artifact root, not the browser-side
JavaScript. `tests/facade-conformance.test.ts` runs them on the TypeScript host
and `python/tests/test_conformance.py` on the Python host.

## Running a case

A runner creates an empty sandbox directory with an `artifacts/` directory
inside it, applies the case's `fs` entries, and builds a fresh host with
`artifacts/` as its artifact root, no keeper tab and the case's `host` options.
The fake Stagehand has one page whose URL is `page.url` (default
`about:blank`), whose snapshot is `page.snapshot`, and whose screenshot is the
base64 bytes `page.screenshot`. A case's `context` can replace that one page
with several registered pages (`pages`, each with an `id` and its own
`snapshot`) and script what `context.activePage()` does (`activePage`): return
the page with that id (default: the first page), return no page (`null`), or
raise an SDK error with `throw.message` (the Python runner raises
`stagehand.rpc_client.RPCError`). The fake records `newPage` and
`setActivePage` calls.
Each step then:

1. sets the page URL to `pageUrl` and the page's snapshot to `snapshot`, when
   present (both persist for later steps);
2. queues the step's `batch` responses: each experimental_batch call takes the
   next one, which either returns `return` or raises an error with `throw.name`
   and `throw.message`;
3. calls the tool in `call` and checks `expect`;
4. checks that every queued response was used, that the batch calls made
   match `sent` exactly, and that the options the host passed to
   `page.screenshot` equal `screenshotOptions` (`{ type, fullPage?, quality? }`),
   when present.

After the last step it checks the case's `expect`.

## Format

Each file holds `{ "cases": [...] }`. A case:

| Field            | Meaning                                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | What the case shows.                                                                                                                                                                                        |
| `notApplicable`  | Optional `{ "<host>": "reason" }` (`typescript` or `python`): that host skips the case, for the reason given.                                                                                               |
| `host`           | Optional host options, `{ "quietWait"? }` (see `contract.runOptions`); a missing option is the host default.                                                                                                |
| `page`           | Optional `{ url, snapshot: { formattedTree, xpathMap }, screenshot }`.                                                                                                                                      |
| `fs`             | Optional sandbox setup, in order: `{ "dir" }`, `{ "file", "base64" }`, or `{ "symlink", "target" }` (the target is stored as written, relative to the link). Paths are relative to the sandbox and use `/`. |
| `steps[].call`   | `{ "tool": "run", "code" }`, `{ "tool": "run", "actions" }`, `{ "tool": "snapshot", "includeIframes"? }`, or `{ "tool": "screenshot", "type"?, "fullPage"?, "quality"? }`.                                  |
| `steps[].expect` | `{ "result" }`: the tool's return value (run code: the value; run actions: `{ completed, url }`; snapshot: the formatted tree; screenshot: `{ data, mimeType }`). Or `{ "error" }`, below.                  |
| `steps[].sent`   | Batch calls in order: `{ "callback": "run", "code", "input"? }` when it sent `runPrelude + code + runEpilogue`, `{ "callback": "actionRunner", "input" }` when it sent `actionRunner` with that input.      |
| `context`        | Optional `{ pages?, activePage? }`, above.                                                                                                                                                                  |
| `expect.closed`  | Whether the host closed the Stagehand session (exactly once, or never).                                                                                                                                     |
| `expect.tree`    | Every entry under the sandbox, sorted by code unit, without following symlinks: directories end in `/`, symlinks in `@`. Use it to show that nothing else was written.                                      |
| `expect.files`   | Contents of files, relative to the sandbox: base64, or `{ "size" }` in bytes.                                                                                                                               |
| `expect.context` | `{ newPages, setActivePage }`: how many pages the host created, and the ids it passed to `setActivePage`, in order.                                                                                         |

An expected error has a `kind` and, optionally, a `name` and a message:

| `kind`      | The host raised                                                                         |
| ----------- | --------------------------------------------------------------------------------------- |
| `input`     | its ordinary tool error (`StagehandFacadeInputError` in TypeScript).                    |
| `invalid`   | its error for arguments outside the tool's input contract (a `ZodError` in TypeScript). |
| `execution` | the error thrown by the agent's code, with that `name` and message.                     |
| `batch`     | the error the batch call itself raised, unchanged.                                      |
| `sdk`       | the error another Stagehand SDK call raised (e.g. `context.activePage()`), unchanged.   |
| `syntax`    | a syntax error for run code, before sending anything. Messages differ between parsers.  |

The message is `message` verbatim, or `contractError`: a key of
`contract.errors` in the bundle, with `${key}` placeholders filled from
`params`.

Two generators keep large or machine-specific values out of the files; a runner
expands them in batch `return` values and expected `result` values, and nowhere
else:

- `{ "$repeat": s, "count": n, "suffix"?: t }` is `s` repeated `n` times, then `t`.
- `{ "$sandbox": p }` is the absolute path of `p` inside the sandbox.

## Rules the cases pin

A run result must have the envelope's shape (see `src/facade/bundle.ts`);
otherwise the host fails with `RUN_RESULT_MALFORMED_ERROR` and neither writes
artifacts nor closes. Types are exact: `1` is not `true` and `true` is not a
number. Artifact bytes must be padded RFC 4648 base64 (`+/`, no line breaks),
as `btoa` writes it. The caps in `contract.limits` are checked before any
artifact is written: first the artifact count, then for each artifact in order
its decoded size and then the running total. Artifacts are then written in order, each path checked as
it is reached, so artifacts before a rejected path stay written. A path error
takes precedence over the code's own error, which takes precedence over the
value cap. The value cap counts the UTF-8 bytes of the value's compact JSON, with
non-ASCII characters unescaped (Python: `separators=(",", ":")`,
`ensure_ascii=False`). An execution error's name and message are redacted as in
`src/harness/redact.ts` before the name is checked against
`/^[A-Za-z][A-Za-z0-9]*Error$/`; any other name becomes `Error`.
A run's batch input is empty unless the host turned a run option on; then it
carries exactly those options (`{ "quietWait": true }`). `sent` lists a run's
`input` only when it is not empty.
Whatever fails after a valid envelope, the host closes the session when
`closeRequested` is true and then raises the error, and later calls fail with
`FACADE_BROWSER_CLOSED_ERROR`.

## Environment and browser launch

The cases do not cover the environment allowlist, because no host they drive
reads or forwards the environment. The rule belongs to whatever launches the
browser or a child process: the stdio server (`src/facade/stdio-server.ts`)
builds its Stagehand and browser from `STAGEHAND_*` and `BROWSERBASE_*`
variables (`stagehandFacadeConfigFromEnv`), and code that spawns the server or
an agent harness passes it only those (`buildAllowlistedEnv` in
`src/harness/env.ts`). Their own tests check that.

`StagehandFacadeTools`, in TypeScript and in Python, takes a Stagehand the
caller has already built and never launches a browser, spawns a process or
reads the environment, so there is nothing to forward. The Python package has
no stdio server or launcher, so it has no allowlist case at all; a host that
adds one must apply the same rule.
