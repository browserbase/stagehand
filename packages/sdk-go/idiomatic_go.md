# Stagehand Go SDK design notes

This document is the working contract for a clean, idiomatic Go SDK that remains behaviorally aligned with the TypeScript and Python SDKs. It intentionally separates cross-language parity from language-specific syntax: users should find the same Stagehand objects and operations in every SDK, but the Go API should still look like Go.

Research snapshot: 2026-07-21.

## Recommendation in one page

- Keep `packages/protocol/stagehand.v4.json` as the single source of truth for wire models and method names.
- Generate the public Go wire types. Hand-write the small client, object wrappers, lifecycle management, and browser-source adapters around those generated types.
- Do not hand-maintain a second set of protocol structs. Do not generate the ergonomic client surface from JSON Schema.
- Use one small public package named `stagehand`. Put transports and browser-launch details under `internal/`; do not export an `RPCClient` or transport abstraction.
- Expose concrete pointer types such as `*Stagehand`, `*BrowserContext`, `*Page`, and `*Locator`. Define interfaces where they are consumed, not preemptively in the SDK.
- Put `context.Context` first on every operation that can block or perform I/O. Do not store contexts on clients.
- Return ordinary Go `(value, error)` results. Never panic for a recoverable SDK or service failure.
- Use explicit option structs for operation options and explicit constructors for mutually exclusive browser sources. Reserve functional options for orthogonal client-wide configuration.
- Make clients safe for concurrent use, make `Close` idempotent, and give every goroutine an explicit shutdown path.
- Enforce cross-language structure with AST-grep, but use the Go compiler, `go vet`, `staticcheck`, the race detector, fuzz tests, and wire fixtures for facts AST-grep cannot prove.
- Treat generated files as checked-in build artifacts with an exact generator version and a CI staleness check.
- Spike a real JSON Schema-to-Go generator before selecting a runtime validator. The two linked libraries are validators, not model generators.

## What “idiomatic Go SDK” means here

### Package and naming

- Use a short, lower-case package name: `stagehand`, not `stagehand_sdk`, `api`, `types`, or `common`.
- Let the package name carry context: prefer `stagehand.Page` and `stagehand.NewLocal` over `stagehand.StagehandPage` or `stagehand.NewStagehandLocalClient`. Keep `stagehand.Stagehand` as one deliberate brand/parity exception; do not add a second `StagehandClient` type.
- Use Go initialism casing consistently: `ID`, `URL`, `HTTP`, `HTML`, `CDP`, `RPC`, `JSON`, and `LLM`. Examples: `PageID`, `CDPURL`, `SetExtraHTTPHeaders`, `InnerHTML`.
- Export only the supported user surface. Lower-case internal state, helpers, transports, request IDs, and generated implementation details.
- Give every exported package, type, function, method, field whose meaning is not obvious, constant, and variable a complete doc comment suitable for pkg.go.dev.
- Use `gofmt`/`goimports`; do not encode personal formatting preferences in review rules.

```go
// Package stagehand provides browser automation through the Stagehand protocol.
package stagehand

// Page represents a browser page managed by Stagehand.
type Page struct {
	rpc *rpcClient
	ref PageRef
}
```

### Public API shape

- Use concrete structs and pointer receivers for stateful clients and identity-bearing wrappers.
- Keep required inputs explicit. Put optional inputs in a method-specific options struct passed last; `nil` and the zero options value must behave the same.
- Avoid long positional argument lists, fluent chains that hide errors, Java-style builders, getters/setters for plain data, and `WithContext` method variants.
- Use multiple constructors when configuration modes are mutually exclusive. Stagehand's local, CDP, and Browserbase sources have different required fields; one giant partially valid config is easy to misuse.
- Constructors should validate local invariants but should not silently perform network I/O. `Init(ctx)` remains the visible I/O boundary, matching the existing lifecycle.
- Return wrapper objects for identity and behavior (`*Page`, `*Locator`). Return generated values or pointers consistently for data models; settle that convention before publishing v1.
- Non-I/O composition methods such as `Locator`, `First`, and `Nth` do not need a context.
- Preserve the same conceptual object graph as TypeScript and Python even when access syntax differs. A Go `Context()` method may correspond to a TypeScript/Python property.

```go
client, err := stagehand.NewLocal(stagehand.LocalOptions{
	Headless: stagehand.Bool(true),
})
if err != nil {
	return err
}

if err := client.Init(ctx); err != nil {
	return err
}
defer func() {
	closeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := client.Close(closeCtx); err != nil {
		logger.Printf("close Stagehand: %v", err)
	}
}()

browserContext, err := client.Context()
if err != nil {
	return err
}
page, err := browserContext.ActivePage(ctx)
if err != nil {
	return err
}
if page == nil {
	return errors.New("stagehand: initialized without an active page")
}
if _, err := page.Goto(ctx, "https://example.com", nil); err != nil {
	return err
}
```

Proposed constructor family:

```go
func NewLocal(options LocalOptions) (*Stagehand, error)
func NewCDP(cdpURL string, options *CDPOptions) (*Stagehand, error)
func NewBrowserbase(apiKey string, options *BrowserbaseOptions) (*Stagehand, error)
```

This is preferable to mirroring the Python overloads as one Go struct full of conditionally required pointers. If a single `New` entry point is important for product consistency, use an explicit source value with constructors that make invalid states difficult to express; do not use `map[string]any`.

### Context, cancellation, and lifecycle

- The first parameter of every public method that can block, perform I/O, wait, retry, or do significant work is `ctx context.Context`.
- Pass the caller's context through RPC, WebSocket writes, browser launch/connect, retries, and cleanup. Do not replace it with `context.Background()` below the public boundary.
- Never store a context in `Stagehand`, `Page`, `Locator`, or an options struct.
- Do not accept a nil context. Document cancellation behavior and return a wrapped `context.Canceled` or `context.DeadlineExceeded` so `errors.Is` works.
- `Close` must be safe to call more than once. It must stop request handlers/read loops, reject or finish pending calls, close owned resources, and avoid goroutine leaks.
- A caller cancellation stops the caller's wait; ownership rules decide whether it also cancels the underlying shared browser or RPC connection.
- Do not launch fire-and-forget goroutines. The owning type needs a cancel function or closed channel plus a wait mechanism.
- Test lifecycle code with `go test -race ./...` and explicit cancellation/close races.

```go
func (p *Page) Title(ctx context.Context) (string, error) {
	var result PageTitleResult
	if err := p.rpc.call(ctx, methodPageTitle, PageTitleParams{PageID: p.ref.ID}, &result); err != nil {
		return "", fmt.Errorf("page title: %w", err)
	}
	return result.Title, nil
}
```

### Options and optional values

- Use an options struct for per-operation optional values. This is easy to extend without breaking callers and maps cleanly to generated params.
- Use functional options only for orthogonal cross-cutting client configuration such as a test transport, logger, or retry policy. Avoid using functional options to model mutually exclusive browser sources.
- Represent “not provided” separately from a meaningful zero value. For optional scalar wire fields, that usually means `*bool`, `*int`, `*float64`, or `*string`, with small helpers such as `stagehand.Bool(true)` if useful.
- Audit optional-and-nullable fields separately. A pointer alone conflates absent and explicit JSON `null`; use a generated presence wrapper when the protocol distinguishes all three states.
- Copy caller-owned slices and maps retained beyond the call so later caller mutation cannot race with the SDK.
- Keep wire JSON tags exact even when Go names differ: `CDPURL string \`json:"cdpUrl"\``.

```go
type PageGotoOptions struct {
	TimeoutMS *int       `json:"timeoutMs,omitempty"`
	WaitUntil *LoadState `json:"waitUntil,omitempty"`
}

func (p *Page) Goto(
	ctx context.Context,
	rawURL string,
	options *PageGotoOptions,
) (*Page, error)
```

### Errors

- Return `error` last. On failure, other return values are unspecified and should normally be their zero value.
- Never panic for invalid user input, protocol errors, transport errors, cancellation, or server responses. Panic is reserved for impossible package invariants.
- Add concise operation context with `%w`; avoid repeating details already present in the cause.
- Preserve structured failures for programmatic inspection with `errors.Is` and `errors.As`.
- Define only useful stable error categories. Likely examples are `*RPCError`, a client configuration error, and a closed-client sentinel. Do not create a unique error type for every message.
- `RPCError` should retain the wire code, message, optional data, and method. Transport errors should preserve their original cause.
- Do not log and return the same error. The layer that can handle a failure logs it; library code generally returns it.
- Aggregate initialization and cleanup failures without losing either cause.

```go
var rpcErr *stagehand.RPCError
if errors.As(err, &rpcErr) {
	fmt.Printf("method=%s code=%d\n", rpcErr.Method, rpcErr.Code)
}
```

### Interfaces, dependencies, and testability

- Return concrete SDK types. Let consumers define the narrow interfaces they need.
- Keep an unexported transport interface only where the SDK genuinely has multiple implementations or needs a deterministic test seam.
- Accept standard-library interfaces at natural boundaries: `io.Reader`, `io.Writer`, `http.RoundTripper`, or a minimal internal WebSocket interface.
- Do not export pointers to interfaces and do not create “IStagehand”/“StagehandInterface” mirrors.
- Prefer the standard library. Every runtime dependency expands the SDK's compatibility, security, and release surface.
- Do not use mutable package globals for API keys, clients, loggers, configuration, or test overrides.
- Ensure public clients are safe for concurrent use by multiple goroutines, or document a deliberately narrower guarantee before release.

### Generated JSON models

- Generate only the wire-model layer from `packages/protocol/stagehand.v4.json`; hand-write ergonomic API inputs when Go needs a better call shape.
- Generate into a stable public package location. If public methods expose generated models, those types cannot live under `internal/`. The simplest initial layout is generated files in package `stagehand`, clearly named `models.gen.go` and excluded from hand-edit lint rules.
- Start every generated file with the standard marker: `// Code generated ... DO NOT EDIT.`
- Pin the generator exactly. Generation must be deterministic across machines.
- Make `just generate` rebuild the canonical schema first, generate Go, format it, and make `just check` fail on a diff.
- Preprocess the schema narrowly and transparently, as the Python generator already does for transport envelopes. Do not silently weaken `oneOf`, `anyOf`, `const`, unknown-field, or nullability semantics.
- Generate named string types and constants for closed enums. Unknown server enum values should remain diagnosable; decide whether decoding rejects them before v1.
- Use custom marshal/unmarshal code or a presence type when a union or absent/null/value distinction cannot be represented by a plain struct.
- Keep dynamic JSON as `json.RawMessage` at the wire boundary. Avoid eagerly spreading `any` throughout the public API.
- `additionalProperties: false` must be tested; ordinary `json.Unmarshal` does not by itself make the entire generated model contract obvious to users.
- Validate both inbound results and outbound params at the RPC boundary if generated types do not enforce the full schema in both directions.
- Add golden tests for every difficult schema shape, then run whole-protocol round trips. Current schema pressure points are substantial: 67 methods, 195 definitions, 52 `anyOf` uses, 4 `oneOf` uses, 167 `const` uses, 23 enums, and 304 `additionalProperties` uses.

### Dynamic JSON and Go-specific API gaps

- Go does not allow methods with their own type parameters, so TypeScript/Python-style generic `page.evaluate` cannot be translated literally.
- Choose one explicit Go shape and document it:
  - `Evaluate(ctx, expression) (json.RawMessage, error)` plus a package-level `EvaluateAs[T](ctx, page, expression) (T, error)` helper; or
  - `Evaluate(ctx, expression, destination any) error`, following `json.Unmarshal`-style destination APIs.
- Prefer `json.RawMessage` over `map[string]any` when the SDK is only carrying JSON through.
- Use `[]byte` for screenshots and other owned binary results. Use `io.Reader`/`io.ReadCloser` only when streaming is real and ownership is documented.

### Tests, examples, and documentation

- Use table-driven tests with descriptive `t.Run` cases where multiple inputs share behavior.
- Test from both package perspectives: white-box tests for internals and `stagehand_test` examples/tests for the public API.
- Use `httptest`, in-memory transports, and deterministic fakes; do not require live credentials for unit tests.
- Add race tests for send/response, cancellation, request-handler callbacks, and `Close`.
- Fuzz JSON-RPC envelopes and generated union unmarshalling. Invalid input must return errors, not panic.
- Put runnable examples in separate directories such as `examples/act/main.go`; several `package main` files with several `main` functions cannot share one directory.
- Keep the TypeScript, Python, and Go example inventory and public-operation inventory identical after normalizing file layout and naming.
- Make the README's first example copy-pasteable, short, and explicit about context, errors, and cleanup.
- Treat pkg.go.dev doc comments as the API reference; keep conceptual documentation and cross-language guides in the existing docs package.

### Compatibility and releases

- Choose the public module path before writing generated imports. In a monorepo subdirectory, module path and tag prefixes affect whether `go get` can resolve releases.
- State and test a minimum Go version. Do not let a generator or runtime validator raise it accidentally.
- Start at `v0` while the public shape is moving. Treat exported names, method signatures, struct fields, JSON behavior, errors, and module paths as compatibility commitments at v1.
- Keep generated model changes reviewable. CI should show the schema change and its generated Go diff together.
- Run at minimum: `gofmt`, `go vet ./...`, `staticcheck ./...`, `go test ./...`, `go test -race ./...`, generated-file staleness, public API compatibility, and the repository's cross-language parity suite.
- Add `govulncheck ./...` to the release/security path.

## JSON Schema tooling decision

The model generator and the runtime validator are two different decisions. They should not be conflated.

### Linked candidates

- [`xeipuuv/gojsonschema`](https://github.com/xeipuuv/gojsonschema) is a runtime validator, not a JSON Schema-to-Go model generator. Its documented support stops at Draft 4/6/7 while Stagehand declares Draft 2020-12. The inspected default-branch commit is `b076d39a02e5015af0a2a96636e4cc479ecd9f45` from 2020. It is not a viable primary tool for this schema.
- [`kaptinlin/jsonschema`](https://github.com/kaptinlin/jsonschema) is an active runtime validator with Draft 2020-12 support. Its `schemagen` command parses existing Go structs and generates schema-construction methods; it does not generate Go structs from an input JSON Schema. The inspected commit is `e39feffecd18896173804f627c8ec2b9486ad181`, and its current `go.mod` requires Go 1.26.4. It may be a runtime-validation candidate only if that Go floor matches the SDK support policy.
- `xeipuuv/gojsonschema` and `omissis/go-jsonschema` are retained under the repo's ignored `vendor-repos/` research area so their source and docs can be inspected locally without committing third-party repositories into the SDK. The `kaptinlin/jsonschema` comparison checkout has been removed.

### Generator to spike first

- [`omissis/go-jsonschema`](https://github.com/omissis/go-jsonschema) was the closest initial fit found: it explicitly generates Go types and validating unmarshal code from JSON Schema, handles local `$defs`/references, and is actively released.
- It is still pre-v1 and documents incomplete validation support. The completed spike below rejects it as the sole source of union and validation behavior, but the model PR uses it successfully for ordinary structs and enums behind a narrow repository-owned projection.
- [`quicktype`](https://github.com/glideapps/quicktype) is a useful second baseline for type-shape comparison, but its generated serializers are not proof of complete JSON Schema validation.
- If neither preserves the Stagehand schema without broad patches, a small repository-owned generator over a parsed intermediate representation may be safer than carrying a large fork. That decision should come only after recording concrete incompatibilities.

### Omissis spike result (2026-07-22)

- The ignored research checkout is pinned at release `v0.23.1`, commit `5c08d7efc3b5e15bed8087f7b61ee495fc02e7ee`. The release requires Go 1.25 to build the generator, although model-only output has no generator runtime dependency.
- It consumed the unchanged Draft 2020-12 Stagehand schema and resolved its top-level `$defs`. There is no generator-driven reason to downgrade the canonical schema.
- A full-schema, model-only run generated 4,268 lines and 394 type declarations and compiled successfully. Applying the same projection used by Python—remove `$id` and the four transport-envelope definitions—reduced the useful output to 2,858 lines, 322 type declarations, and 228 structs.
- Zod emits nullable primitives as `anyOf: [T, null]`. Omissis turns those fields into `interface{}`. A temporary, standards-preserving adapter normalized 21 such nodes to `type: [T, null]`, reducing `interface{}` occurrences from 57 to 30 and producing named pointer types.
- The adapter cannot fix real unions. The output still contains 23 named empty-interface types, including `ModelConfig`, `ProxyConfig`, `LLMGenerateParams`, `LLMGenerateResult`, `LLMMessageContentBlock`, `CookieFilter`, `VariableValue`, and nullable referenced results. A compile-time probe confirmed that unrelated integers and slices can be assigned to several of these protocol positions.
- `const` constraints become ordinary `string` or `bool` fields in model-only output. Go has no literal types, so discriminators require generated enum-like types, constructors, or validating unmarshalling to prevent invalid values.
- Model-only output uses ordinary `encoding/json`; it accepts missing required fields and unknown properties even where the schema sets `additionalProperties: false`.
- Validation-enabled generation produced substantially more code and emitted `map[string]interface{}` defaults where the generated field type is `TelemetryTraces`.
- The validation mode also relies on a generator-specific `goJSONSchema` extension for custom types. Adding those extensions to the canonical cross-language schema would couple the protocol to one Go generator and is not recommended.

### Implemented model boundary

The `add-go` model PR adopts the narrow hybrid, without modifying the canonical Draft 2020-12 schema or post-processing generated Go source:

- A repository-owned projection starts from the definitions reachable through every registered method and notification. It replaces the top-level RPC registry with one unexported model catalog, so Omissis generates the public wire types without also generating useless registry wrapper structs.
- Ordinary objects, maps, aliases, and string enums are emitted by pinned `go-jsonschema` `v0.23.1` in model-only mode. The checked-in result has no SDK runtime dependency. `LoadState` is the one handwritten enum because its concatenated wire values otherwise produce non-idiomatic exported constant names.
- The projection converts only the schema's `T | null` pairs to Go pointers. It routes real unions through the generator's custom-type extension and fails generation if any unhandled `anyOf` or `oneOf` remains. This prevents a future schema change from silently becoming `interface{}`.
- Handwritten wrappers cover the irreducible Go cases: model, proxy, variable, cookie, LLM, boolean-or-list, string-or-list, and string-or-number unions. Constructors set known discriminators, JSON decoding rejects unknown discriminators, and zero-value unions fail to marshal.
- `json.RawMessage` is used for intentionally arbitrary JSON. LLM callback results preserve allowed unknown properties in an explicit `AdditionalProperties` map.
- The generator lives in a nested module because the pinned tool requires Go 1.25. The generated SDK module currently targets Go 1.22 and does not import Omissis.
- Tests compare the generated catalog with the complete reachable protocol definition graph, forbid `interface{}` fallbacks, and round-trip representative union and open-object values. CI also checks generator staleness, formatting, vet, tests, and build.

This is deliberately schema projection, not output patching: Omissis output is accepted as generated or generation fails. The only custom logic is the part Go cannot express as native tagged unions.

### Remaining concerns for the client

- Model-only Omissis output does not enforce required fields, `const`, regexes, formats, numeric bounds, or `additionalProperties: false`. Union constructors enforce the critical discriminators, but complete local JSON Schema validation remains a separate decision. The server can remain authoritative, or the client can add a Draft 2020-12 validator at its request/response boundary.
- A Go pointer cannot distinguish an omitted field from an explicitly present JSON `null`. The current protocol models collapse those states. Add a presence wrapper only if the client finds a method where that distinction changes behavior.
- Omissis emits schema `const` properties as ordinary Go fields. Later client-facing constructors should set constants for browser sources, response formats, and similar tagged objects; callers constructing generated structs directly can still set invalid strings.
- Required fields are ordinary zero-valued Go fields. The thin client currently relies on authoritative RPC errors rather than duplicating protocol validation; generated structs alone do not prove a required string was supplied.
- The module path is `github.com/browserbase/stagehand/packages/sdk-go`, matching the module's `packages/sdk-go` directory inside `github.com/browserbase/stagehand`. Releases from this layout will need subdirectory-prefixed Go tags such as `packages/sdk-go/v0.1.0`.
- Dynamic extract/evaluate payloads intentionally remain `json.RawMessage`. `ExtractAs` provides caller-selected typed decoding without weakening the generated protocol boundary to `any`.
- Single-string-or-array values and single-block-or-array LLM content normalize to arrays when marshalled. Arrays are schema-valid and give callers one stable Go representation, but byte-for-byte preservation of the input shape is not promised.
- The handwritten union layer is part of the public model API. Before v1, evaluate constructor/accessor naming against the first thin-client implementation and real examples.
- Browser source resolution and the CDP-backed JSON-RPC transport are intentionally stubbed in the first thin-client pass. Examples compile and exercise the public surface, but cannot complete `Stagehand.Init` until that bootstrap layer is implemented.

Conclusion: Omissis is suitable for the generated struct/enum layer, but not as a validator or union generator. The projection-plus-union boundary keeps custom code small, explicit, and testable while retaining the canonical Draft 2020-12 schema.

Generator acceptance gates:

- Consume `stagehand.v4.json` as Draft 2020-12 without changing the canonical schema.
- Produce deterministic, `gofmt`-clean code with stable names and no duplicate declarations.
- Preserve required versus optional versus nullable fields.
- Preserve string enums and constants with idiomatic exported names.
- Represent discriminated object unions safely and reject zero or multiple `oneOf` variants where required.
- Preserve open maps and closed objects correctly.
- Preserve `uri`, `uuid`, and `byte` wire formats without surprising public Go types.
- Resolve every local `$ref` and keep the generated dependency graph cycle-safe.
- Round-trip representative valid values to byte-equivalent JSON where ordering is irrelevant.
- Reject representative invalid values for each schema pressure point.
- Allow the four JSON-RPC transport envelopes to be excluded without dropping public operation params/results.
- Support an exact pinned version, checked-in output, and a deterministic CI staleness check.
- Avoid a runtime dependency when generation alone is sufficient; otherwise keep the runtime dependency small and compatible with the chosen minimum Go version.

## AST-grep parity contract

AST-grep should enforce stable structural invariants, not subjective style and not facts that require Go type information.

### Extend the existing parity suite

- Add `@ast-grep/lang-go` at the same pinned language-package version as Python and register it in `rules/ast-grep/sdk-parity.test.ts` and `example-parity.test.ts`.
- Extend the SDK language set from TypeScript/Python to TypeScript/Python/Go.
- Map the same object inventory to Go receiver types: `Stagehand`, `BrowserContext`, `BrowserClipboard`, `Page`, and `Locator`.
- Normalize TypeScript `camelCase`, Python `snake_case`, and Go `PascalCase` to one comparison key.
- Compare conceptual public members, not only syntax categories. Go accessor methods such as `Context()` correspond to properties in the other SDKs.
- Discover Go methods from `method_declaration` receiver nodes rather than classes.

### Cross-language rules to implement

- Every registered Stagehand protocol operation is referenced by each SDK client.
- Every public RPC-backed operation exists on the corresponding object in all three SDKs.
- Every RPC call uses a declared wire method.
- Every Go RPC boundary uses the generated params and result types referenced by that method in the canonical schema.
- The public member inventory remains aligned after an explicit, reviewed normalization/exception map.
- Low-level RPC and transport types are absent from public exports.
- Example inventories match (`act`, `extract`, `observe`, `custom-llm`) despite Go's directory-per-command layout.
- Matching examples call the same conceptual public SDK operations.
- Every example constructs Stagehand through the public package, calls `Init`, handles returned errors, and calls `Close` without importing internals.

### Go-specific structural rules worth enforcing

- Every public RPC-backed receiver method has `context.Context` as its first ordinary parameter.
- Every public RPC-backed method returns `error` as its final result.
- Stateful SDK object methods use pointer receivers.
- Calls into the RPC boundary pass context, method, generated params, and a generated result destination in one recognizable shape.
- No public declaration exposes `rpcClient`, a WebSocket implementation, or another internal transport type.
- No `context.Context` field is stored on an SDK object or options struct.
- No recoverable path in non-test library code calls `panic` or `log.Fatal`.
- Generated files are excluded from hand-written style rules but included in protocol type/inventory checks.

### Do not ask AST-grep to prove

- Interface satisfaction or assignability.
- Concurrency safety, data races, goroutine leaks, or idempotent close behavior.
- Full JSON Schema validation semantics.
- Whether an error chain preserves `errors.Is`/`errors.As` behavior.
- Whether contexts actually reach the network operation.
- Public API compatibility between released module versions.

Use compiler/type tests, behavioral tests, the race detector, fuzzing, golden JSON fixtures, and an API-diff tool for those properties. AST-grep is most valuable here as a readable architecture and inventory guard.

## Proposed implementation stack

1. **Decision/spike PR**
   - Set the module path and minimum Go version.
   - Run the generator candidates against the complete current schema.
   - Commit a feature matrix, representative generated output, round-trip fixtures, and the generator decision.
   - Decide whether runtime validation is needed in addition to generated validation.

2. **Generated protocol-model PR**
   - Add `go.mod`, generation tooling, exact tool pinning, generated models, enum/union helpers, and stale-generation checks.
   - Add focused tests for nullability, unions, constants, enums, formats, closed objects, open maps, and JSON-RPC envelope exclusion.
   - Wire `just generate`, `just check`, CI, and release build checks.

3. **Transport and lifecycle PR**
   - Add the internal JSON-RPC/WebSocket client, cancellation, request correlation, notifications, client-side LLM requests, shutdown, and typed errors.
   - Prove close/cancellation behavior with race tests and fuzz the envelope decoder.

4. **Public client/object PR**
   - Add browser-source constructors and `Stagehand`, `BrowserContext`, `BrowserClipboard`, `Page`, and `Locator` wrappers.
   - Match the existing operation inventory while using Go contexts, options, errors, naming, and return conventions.

5. **Parity/examples/docs PR**
   - Extend AST-grep and docs tests to Go.
   - Add all four runnable Go examples and the public README path.
   - Add module publishing, smoke tests, and the Go release job.

If these are stacked PRs, each targets its immediate predecessor, following the repository rule. `add-go` can remain the umbrella branch based on `add-docs`, with implementation branches stacked beneath it once the decision PR is accepted.

## Decisions needed before publishing the client

- **Go support window:** What minimum Go version must the SDK support? This immediately affects the validator choice and whether newer language/library features are available.
- **Validation boundary:** Must Go reject all invalid outbound params locally, validate inbound results only, or rely on the server for semantic constraints? The answer determines whether a runtime validator is required.
- **Nullability contract:** Does the protocol rely on distinguishing omitted fields from explicit `null` in requests or responses? If yes, generated presence wrappers are required.
- **Constructor shape:** Approve explicit `NewLocal`, `NewCDP`, and `NewBrowserbase` constructors, or require one cross-language-looking `New` API.
- **Close signature:** Prefer Go's conventional `Close() error`, or require `Close(ctx context.Context) error` so the protocol-backed close is cancellable? Both are defensible; exposing both would be confusing.
- **Dynamic evaluate result:** Choose `json.RawMessage` plus `EvaluateAs[T]`, or a destination argument.
- **Compatibility target:** Is operation inventory parity sufficient, or must public model names and parameter grouping also match the other languages exactly? Exact signatures would make the Go API less idiomatic.
- **Release topology:** Does Go ship from the same release workflow/version as Python and TypeScript, or on an independent module version?

## Recommended reading and exemplars

- [Azure SDK Design Guidelines for Go](https://azure.github.io/azure-sdk/golang_introduction.html) — the most directly applicable SDK-specific guide: contexts, client methods, option structs, concurrency, errors, documentation, and compatibility.
- [Google Go Style Guide](https://google.github.io/styleguide/go/) and [best practices](https://google.github.io/styleguide/go/best-practices.html) — current reasoning about clear APIs, interfaces, options, errors, and maintainability.
- [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments) — concise community conventions for contexts, errors, comments, names, interfaces, goroutine lifetime, and testing.
- [Package names](https://go.dev/blog/package-names) — design the package from the caller's point of view and avoid repetitive exported names.
- [Effective Go](https://go.dev/doc/effective_go) — foundational idioms; its own introduction notes that it is not actively updated, so use it with the newer guides above.
- [Developing and publishing Go modules](https://go.dev/doc/modules/developing) — module layout, versioning, discoverability, and compatibility.
- [Go Style discussion on Hacker News](https://news.ycombinator.com/item?id=33652343) — useful community commentary around Google's guide; informative, but not normative.
- [OpenAI's Go SDK](https://github.com/openai/openai-go) — current examples of contexts, concrete clients, functional request options, typed errors, unions, and pagination.
- [Stripe's Go SDK](https://github.com/stripe/stripe-go) — current examples of a concrete client, resource grouping, context-first methods, options, iteration, mocking seams, and major-version policy.
- [ast-grep Go language support](https://ast-grep.github.io/reference/languages.html) and [Go rule examples](https://ast-grep.github.io/catalog/go/) — confirms Go parsing support and the receiver/function AST patterns the parity suite can build on.
