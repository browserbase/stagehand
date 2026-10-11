// Package stagehand automates browsers for AI agents with natural-language
// actions, page observation, and structured data extraction in Go.
//
// # Browser sessions
//
// Use [LaunchLocalBrowser] to launch Chrome or Chromium with the bundled Stagehand
// extension, or [LaunchBrowserbase] to create a hosted Browserbase session.
// [ConnectLocalBrowser] and [ConnectBrowserbase] attach to existing sessions.
// Local sessions require Chrome or Chromium; the extension ships with this module.
//
// Pass the browser to [Create] with a [ModelConfig] or a custom [LLMGenerateFunc].
// [Stagehand.Act] performs an instruction, [Stagehand.Observe] discovers actions,
// and [Extract] derives a JSON Schema from a Go type and decodes the extracted data.
// [Page] and [PageLocator] provide deterministic browser operations.
//
// Operations accept a context for cancellation and deadlines. Close the Stagehand
// client before closing its browser, and check errors from both cleanup calls.
//
// # Browserbase services
//
// [SearchBrowserbase] and [FetchBrowserbase] search the web and retrieve content
// without a browser session. They require a Browserbase API key.
//
// See https://docs.stagehand.dev for setup and usage, and
// https://github.com/browserbase/stagehand/issues to report problems.
package stagehand
