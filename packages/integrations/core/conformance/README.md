# Facade conformance cases

Every facade host (the TypeScript `StagehandFacadeTools`, and hosts in other
languages built on `dist/facade-bundle.json`) must pass every case in `cases/`.
The cases drive a host against a fake Stagehand, so they check what the host
does with batch results, snapshots and the artifact root, not the browser-side
JavaScript. `tests/facade-conformance.test.ts` runs them on the TypeScript host.

## Running a case

A runner creates an empty sandbox directory with an `artifacts/` directory
inside it, applies the case's `fs` entries, and builds a fresh host with
`artifacts/` as its artifact root and no keeper tab. The fake Stagehand has one
page whose URL is `page.url` (default `about:blank`), whose snapshot is
`page.snapshot`, and whose screenshot is the base64 bytes `page.screenshot`.
Each step then:

1. sets the page URL to `pageUrl`, when present;
2. queues the step's `batch` responses: each experimental_batch call takes the
   next one, which either returns `return` or raises an error with `throw.name`
   and `throw.message`;
3. calls the tool in `call` and checks `expect`;
4. checks that every queued response was used, and that the batch calls made
   match `sent` exactly, when present.

After the last step it checks the case's `expect`.

## Format

Each file holds `{ "cases": [...] }`. A case:

| Field            | Meaning                                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | What the case shows.                                                                                                                                                                                        |
| `page`           | Optional `{ url, snapshot: { formattedTree, xpathMap }, screenshot }`.                                                                                                                                      |
| `fs`             | Optional sandbox setup, in order: `{ "dir" }`, `{ "file", "base64" }`, or `{ "symlink", "target" }` (the target is stored as written, relative to the link). Paths are relative to the sandbox and use `/`. |
| `steps[].call`   | `{ "tool": "run", "code" }`, `{ "tool": "run", "actions" }`, `{ "tool": "snapshot", "includeIframes"? }`, or `{ "tool": "screenshot", "type"?, "fullPage"?, "quality"? }`.                                  |
| `steps[].expect` | `{ "result" }`: the tool's return value (run code: the value; run actions: `{ completed, url }`; snapshot: the formatted tree; screenshot: `{ data, mimeType }`). Or `{ "error" }`, below.                  |
| `steps[].sent`   | Batch calls in order: `{ "callback": "run", "code" }` when the host sent `runPrelude + code + runEpilogue`, `{ "callback": "actionRunner", "input" }` when it sent `actionRunner` with that input.          |
| `expect.closed`  | Whether the host closed the Stagehand session (exactly once, or never).                                                                                                                                     |
| `expect.tree`    | Every entry under the sandbox, sorted by code unit, without following symlinks: directories end in `/`, symlinks in `@`. Use it to show that nothing else was written.                                      |
| `expect.files`   | Contents of files, relative to the sandbox: base64, or `{ "size" }` in bytes.                                                                                                                               |

An expected error has a `kind` and, optionally, a `name` and a message:

| `kind`      | The host raised                                                                        |
| ----------- | -------------------------------------------------------------------------------------- |
| `input`     | its ordinary tool error (`StagehandFacadeInputError` in TypeScript).                   |
| `execution` | the error thrown by the agent's code, with that `name` and message.                    |
| `batch`     | the error the batch call itself raised, unchanged.                                     |
| `syntax`    | a syntax error for run code, before sending anything. Messages differ between parsers. |

The message is `message` verbatim, or `contractError`: a key of
`contract.errors` in the bundle, with `${key}` placeholders filled from
`params`.

Two generators keep large or machine-specific values out of the files; a runner
expands them anywhere in a case before use:

- `{ "$repeat": s, "count": n, "suffix"?: t }` is `s` repeated `n` times, then `t`.
- `{ "$sandbox": p }` is the absolute path of `p` inside the sandbox.

## Rules the cases pin

A run result must have the envelope's shape (see `src/facade/bundle.ts`);
otherwise the host fails with `RUN_RESULT_MALFORMED_ERROR` and neither writes
artifacts nor closes. The caps in `contract.limits` are checked before any
artifact is written: artifact count, then each decoded artifact in order, then
their running total. Artifacts are then written in order, each path checked as
it is reached, so artifacts before a rejected path stay written. A path error
takes precedence over the code's own error, which takes precedence over the
value cap. The value cap counts the UTF-8 bytes of the value's compact JSON.
Whatever fails after a valid envelope, the host closes the session when
`closeRequested` is true and then raises the error, and later calls fail with
`FACADE_BROWSER_CLOSED_ERROR`.
