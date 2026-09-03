# Stagehand

This changelog covers the public Stagehand TypeScript and Python SDKs. Entries before 4.0.0
describe the TypeScript SDK.

## TypeScript SDK 4.1.0

### Minor Changes

- [#2828](https://github.com/browserbase/stagehand/pull/2828) [`e2c8946`](https://github.com/browserbase/stagehand/commit/e2c8946eefb45717fe5a2e992afd57327a1f9505) Thanks [@miguelg719](https://github.com/miguelg719)! - Expose Browserbase Search and Fetch through the Stagehand browserbase facade in TypeScript, Python, and Go.

### Patch Changes

- [#2827](https://github.com/browserbase/stagehand/pull/2827) [`6555e81`](https://github.com/browserbase/stagehand/commit/6555e81e837012088eb12a39c06aed0527a2e5af) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - make browser.close() and browser.context.close() always terminate the browser regardless of keepAlive.

- [#2878](https://github.com/browserbase/stagehand/pull/2878) [`50146e4`](https://github.com/browserbase/stagehand/commit/50146e426baff4e6507c6302dbee50ee0c9bc6bc) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - support discovering and invoking WebMCP tools in out-of-process iframes (OOPIFs)

- [#2790](https://github.com/browserbase/stagehand/pull/2790) [`1011177`](https://github.com/browserbase/stagehand/commit/1011177a3140a93f021745a3e3dc0dce9ee73225) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fail fast on browserbase.connect() when extension is not present

- [#2818](https://github.com/browserbase/stagehand/pull/2818) [`341433a`](https://github.com/browserbase/stagehand/commit/341433acac46a305ad6c2f9a0445e907675f4fb4) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - make stagehand.close() preserve the browser and allow another Stagehand instance to attach later

- [#2754](https://github.com/browserbase/stagehand/pull/2754) [`a21633d`](https://github.com/browserbase/stagehand/commit/a21633d53930abc5d62b8dbd6b608995f2ccb4b1) Thanks [@monadoid](https://github.com/monadoid)! - remove the redundant image type from page screenshot protocol responses.

## Python SDK 4.1.0

### Minor Changes

- [#2828](https://github.com/browserbase/stagehand/pull/2828) [`e2c8946`](https://github.com/browserbase/stagehand/commit/e2c8946eefb45717fe5a2e992afd57327a1f9505) Thanks [@miguelg719](https://github.com/miguelg719)! - Expose Browserbase Search and Fetch through the Stagehand browserbase facade in TypeScript, Python, and Go.

### Patch Changes

- [#2827](https://github.com/browserbase/stagehand/pull/2827) [`6555e81`](https://github.com/browserbase/stagehand/commit/6555e81e837012088eb12a39c06aed0527a2e5af) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - make browser.close() and browser.context.close() always terminate the browser regardless of keepAlive.

- [#2878](https://github.com/browserbase/stagehand/pull/2878) [`50146e4`](https://github.com/browserbase/stagehand/commit/50146e426baff4e6507c6302dbee50ee0c9bc6bc) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - support discovering and invoking WebMCP tools in out-of-process iframes (OOPIFs)

- [#2790](https://github.com/browserbase/stagehand/pull/2790) [`1011177`](https://github.com/browserbase/stagehand/commit/1011177a3140a93f021745a3e3dc0dce9ee73225) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fail fast on browserbase.connect() when extension is not present

- [#2818](https://github.com/browserbase/stagehand/pull/2818) [`341433a`](https://github.com/browserbase/stagehand/commit/341433acac46a305ad6c2f9a0445e907675f4fb4) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - make stagehand.close() preserve the browser and allow another Stagehand instance to attach later

- [#2754](https://github.com/browserbase/stagehand/pull/2754) [`a21633d`](https://github.com/browserbase/stagehand/commit/a21633d53930abc5d62b8dbd6b608995f2ccb4b1) Thanks [@monadoid](https://github.com/monadoid)! - remove the redundant image type from page screenshot protocol responses.

- [#2864](https://github.com/browserbase/stagehand/pull/2864) [`d2d9169`](https://github.com/browserbase/stagehand/commit/d2d91697df6aaad572ac32ac9b9493be396a0f75) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - Make python and golang SDKs reject occupied local chrome debugging ports, and make local browser launch wait for readiness in python.

## Extension Runtime 1.0.2

### Patch Changes

- [#2827](https://github.com/browserbase/stagehand/pull/2827) [`6555e81`](https://github.com/browserbase/stagehand/commit/6555e81e837012088eb12a39c06aed0527a2e5af) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - make browser.close() and browser.context.close() always terminate the browser regardless of keepAlive.

- [#2878](https://github.com/browserbase/stagehand/pull/2878) [`50146e4`](https://github.com/browserbase/stagehand/commit/50146e426baff4e6507c6302dbee50ee0c9bc6bc) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - support discovering and invoking WebMCP tools in out-of-process iframes (OOPIFs)

- [#2818](https://github.com/browserbase/stagehand/pull/2818) [`341433a`](https://github.com/browserbase/stagehand/commit/341433acac46a305ad6c2f9a0445e907675f4fb4) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - make stagehand.close() preserve the browser and allow another Stagehand instance to attach later

- [#2754](https://github.com/browserbase/stagehand/pull/2754) [`a21633d`](https://github.com/browserbase/stagehand/commit/a21633d53930abc5d62b8dbd6b608995f2ccb4b1) Thanks [@monadoid](https://github.com/monadoid)! - remove the redundant image type from page screenshot protocol responses.

## Go SDK 4.1.0

### Minor Changes

- [#2828](https://github.com/browserbase/stagehand/pull/2828) [`e2c8946`](https://github.com/browserbase/stagehand/commit/e2c8946eefb45717fe5a2e992afd57327a1f9505) Thanks [@miguelg719](https://github.com/miguelg719)! - Expose Browserbase Search and Fetch through the Stagehand browserbase facade in TypeScript, Python, and Go.

### Patch Changes

- [#2827](https://github.com/browserbase/stagehand/pull/2827) [`6555e81`](https://github.com/browserbase/stagehand/commit/6555e81e837012088eb12a39c06aed0527a2e5af) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - make browser.close() and browser.context.close() always terminate the browser regardless of keepAlive.

- [#2878](https://github.com/browserbase/stagehand/pull/2878) [`50146e4`](https://github.com/browserbase/stagehand/commit/50146e426baff4e6507c6302dbee50ee0c9bc6bc) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - support discovering and invoking WebMCP tools in out-of-process iframes (OOPIFs)

- [#2790](https://github.com/browserbase/stagehand/pull/2790) [`1011177`](https://github.com/browserbase/stagehand/commit/1011177a3140a93f021745a3e3dc0dce9ee73225) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fail fast on browserbase.connect() when extension is not present

- [#2818](https://github.com/browserbase/stagehand/pull/2818) [`341433a`](https://github.com/browserbase/stagehand/commit/341433acac46a305ad6c2f9a0445e907675f4fb4) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - make stagehand.close() preserve the browser and allow another Stagehand instance to attach later

- [#2754](https://github.com/browserbase/stagehand/pull/2754) [`a21633d`](https://github.com/browserbase/stagehand/commit/a21633d53930abc5d62b8dbd6b608995f2ccb4b1) Thanks [@monadoid](https://github.com/monadoid)! - remove the redundant image type from page screenshot protocol responses.

- [#2864](https://github.com/browserbase/stagehand/pull/2864) [`d2d9169`](https://github.com/browserbase/stagehand/commit/d2d91697df6aaad572ac32ac9b9493be396a0f75) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - Make python and golang SDKs reject occupied local chrome debugging ports, and make local browser launch wait for readiness in python.

## Protocol 2.0.0

### Major Changes

- [#2827](https://github.com/browserbase/stagehand/pull/2827) [`6555e81`](https://github.com/browserbase/stagehand/commit/6555e81e837012088eb12a39c06aed0527a2e5af) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - make browser.close() and browser.context.close() always terminate the browser regardless of keepAlive.

- [#2754](https://github.com/browserbase/stagehand/pull/2754) [`a21633d`](https://github.com/browserbase/stagehand/commit/a21633d53930abc5d62b8dbd6b608995f2ccb4b1) Thanks [@monadoid](https://github.com/monadoid)! - remove the redundant image type from page screenshot protocol responses.

## TypeScript SDK 4.0.2

### Patch Changes

- [#2752](https://github.com/browserbase/stagehand/pull/2752) [`c0a2734`](https://github.com/browserbase/stagehand/commit/c0a2734c46c1fb49e89705b186736cb11b5f78b7) Thanks [@monadoid](https://github.com/monadoid)! - Allow SDK clients to reattach to an initialized Stagehand extension runtime.

## Python SDK 4.0.2

### Patch Changes

- [#2752](https://github.com/browserbase/stagehand/pull/2752) [`c0a2734`](https://github.com/browserbase/stagehand/commit/c0a2734c46c1fb49e89705b186736cb11b5f78b7) Thanks [@monadoid](https://github.com/monadoid)! - Allow SDK clients to reattach to an initialized Stagehand extension runtime.

## Extension Runtime 1.0.1

### Patch Changes

- [#2752](https://github.com/browserbase/stagehand/pull/2752) [`c0a2734`](https://github.com/browserbase/stagehand/commit/c0a2734c46c1fb49e89705b186736cb11b5f78b7) Thanks [@monadoid](https://github.com/monadoid)! - Allow SDK clients to reattach to an initialized Stagehand extension runtime.

## Go SDK 4.0.2

### Patch Changes

- [#2752](https://github.com/browserbase/stagehand/pull/2752) [`c0a2734`](https://github.com/browserbase/stagehand/commit/c0a2734c46c1fb49e89705b186736cb11b5f78b7) Thanks [@monadoid](https://github.com/monadoid)! - Allow SDK clients to reattach to an initialized Stagehand extension runtime.

## TypeScript SDK 4.0.1

### Patch Changes

- [#2666](https://github.com/browserbase/stagehand/pull/2666) [`00fc44c`](https://github.com/browserbase/stagehand/commit/00fc44c2bd6d43414b7ab922efb631155f7951a7) Thanks [@miguelg719](https://github.com/miguelg719)! - Allow overriding the extension asset locations via `STAGEHAND_EXTENSION_ARCHIVE_PATH` and `STAGEHAND_EXTENSION_DIRECTORY_PATH`

- [#2691](https://github.com/browserbase/stagehand/pull/2691) [`7e09557`](https://github.com/browserbase/stagehand/commit/7e09557a6d25361476fd1712eab9d2a53a591782) Thanks [@shrey150](https://github.com/shrey150)! - Track the Stagehand SDK version in Browserbase session metadata.

## Python SDK 4.0.1

### Patch Changes

- [#2691](https://github.com/browserbase/stagehand/pull/2691) [`7e09557`](https://github.com/browserbase/stagehand/commit/7e09557a6d25361476fd1712eab9d2a53a591782) Thanks [@shrey150](https://github.com/shrey150)! - Track the Stagehand SDK version in Browserbase session metadata.

## Go SDK 4.0.1

### Patch Changes

- [#2691](https://github.com/browserbase/stagehand/pull/2691) [`7e09557`](https://github.com/browserbase/stagehand/commit/7e09557a6d25361476fd1712eab9d2a53a591782) Thanks [@shrey150](https://github.com/shrey150)! - Track the Stagehand SDK version in Browserbase session metadata.

## TypeScript SDK 4.0.0

### Major Changes

- Rebuilt Stagehand around its v4 browser protocol and TypeScript SDK. Stagehand is now a protocol-first monorepo with TypeScript, Python, and Go SDKs over a shared core.

  Check the [migration guide](https://docs.stagehand.dev/v4/migrations/v3) for upgrading from v3.

## Python SDK 4.0.0

### Major Changes

- Rebuilt the Stagehand Python SDK around the v4 browser protocol.

  Check the [migration guide](https://docs.stagehand.dev/v4/migrations/v3) for upgrading from v3.

## 3.7.1

### Patch Changes

- [#2359](https://github.com/browserbase/stagehand/pull/2359) [`2cd1edf`](https://github.com/browserbase/stagehand/commit/2cd1edf49e5b726d817805e3258f2fa9b7fa17b0) Thanks [@shrey150](https://github.com/shrey150)! - Remove the noisy AI SDK "system message in messages" warning from `act()`, `extract()`, and `observe()` (including when the agent's own tools call them internally).

- [#2347](https://github.com/browserbase/stagehand/pull/2347) [`84197d8`](https://github.com/browserbase/stagehand/commit/84197d8cbab2461956cecf3fad84a7107610c960) Thanks [@miguelg719](https://github.com/miguelg719)! - Allow OpenAI-compatible models to select the Chat Completions API with `openaiEndpointFormat: "chat"`

## 3.7.0

### Minor Changes

- [#2283](https://github.com/browserbase/stagehand/pull/2283) [`871ca7e`](https://github.com/browserbase/stagehand/commit/871ca7e305f4dc36a6936620735f189647a6de17) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add `context.setDomainPolicy({ allowedDomains: ["allowed.domain"] })` which allows users to define a set of domains that are accessible to stagehand

- [#2274](https://github.com/browserbase/stagehand/pull/2274) [`f31980f`](https://github.com/browserbase/stagehand/commit/f31980f37a8f01cdb7758c91eea9e5f57911af44) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add `context.setDomainPolicy({blockedDomains: ["some.domain"]})` which allows users to define a list of domains that will be blocked by stagehand

### Patch Changes

- [#2305](https://github.com/browserbase/stagehand/pull/2305) [`cd1daad`](https://github.com/browserbase/stagehand/commit/cd1daad7f7655307e951ee68a4a6c5f98928f9bc) Thanks [@shrey150](https://github.com/shrey150)! - Remove the noisy AI SDK "system message in messages" warning logged on every hybrid/DOM `agent.execute()` call.

- [#2328](https://github.com/browserbase/stagehand/pull/2328) [`d287ff4`](https://github.com/browserbase/stagehand/commit/d287ff4d2c96f1aa71abf07b35bc878e0ff34ce3) Thanks [@miguelg719](https://github.com/miguelg719)! - Allow modelName "auto" in the constructor and per-primitive model overrides when running through the Stagehand API

- [#2294](https://github.com/browserbase/stagehand/pull/2294) [`3938590`](https://github.com/browserbase/stagehand/commit/39385906b3bc9d419fee27afbee14c3a5fd4020f) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - automatically close popups that violate user defined domain policy

- [#2298](https://github.com/browserbase/stagehand/pull/2298) [`892701a`](https://github.com/browserbase/stagehand/commit/892701a30f8d4bd6e5cccb721eeee1fee7f6e675) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - Fix CUA `keypress` actions to press key combinations as a single chord.

- [#2345](https://github.com/browserbase/stagehand/pull/2345) [`21826c7`](https://github.com/browserbase/stagehand/commit/21826c75ce978832c5be5bc3e3a06806dd91086e) Thanks [@monadoid](https://github.com/monadoid)! - Repair malformed UTF-16 snapshot text before it reaches model prompts.

- [#2306](https://github.com/browserbase/stagehand/pull/2306) [`8dcef1b`](https://github.com/browserbase/stagehand/commit/8dcef1b49142e83b94d0d9b8ee5b480181aee486) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - Use the screenshot provider's declared media type when sending CUA image payloads. The `setScreenshotProvider` callback now returns `ScreenshotProviderResult` (`{ base64, mediaType }`) instead of a bare base64 string.

- [#2273](https://github.com/browserbase/stagehand/pull/2273) [`93a23d3`](https://github.com/browserbase/stagehand/commit/93a23d3adf04de91d95b2463f6edfde3d1cb7114) Thanks [@miguelg719](https://github.com/miguelg719)! - Add support for the new `google/gemini-3.5-flash` computer-use tools model

- [#2278](https://github.com/browserbase/stagehand/pull/2278) [`022d68f`](https://github.com/browserbase/stagehand/commit/022d68fc81ffe96e16008c3c751ea005eeb0b929) Thanks [@shrey150](https://github.com/shrey150)! - Fix `TypeError: Converting circular structure to JSON` when creating an agent with MCP `integrations` that include a `Client` instance (e.g. a local/stdio server from `connectToMCPServer`). The agent-creation log serialized the raw `integrations` array, and a live MCP `Client` is circular. It now logs a safe descriptor (URL strings kept, client instances summarized) so `agent({ integrations: [client] })` works.

- [#2288](https://github.com/browserbase/stagehand/pull/2288) [`bb5ffa6`](https://github.com/browserbase/stagehand/commit/bb5ffa6f49a41dc4a962d063cbba9cccd193859c) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - clean up cdp session event handlers on target detach

## 3.6.0

### Minor Changes

- [#2178](https://github.com/browserbase/stagehand/pull/2178) [`c49a3fc`](https://github.com/browserbase/stagehand/commit/c49a3fc47ada88322f7e11b7b72085f0147c43e3) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add support for WebMCP

### Patch Changes

- [#2217](https://github.com/browserbase/stagehand/pull/2217) [`147e310`](https://github.com/browserbase/stagehand/commit/147e310b12ffa9a5a03d770b0f071495d7a3287d) Thanks [@monadoid](https://github.com/monadoid)! - Add Azure OpenAI Microsoft Entra ID model auth support.

- [#2231](https://github.com/browserbase/stagehand/pull/2231) [`cf3603d`](https://github.com/browserbase/stagehand/commit/cf3603d1c1f017cd7c195bcbe4300814c694454b) Thanks [@miguelg719](https://github.com/miguelg719)! - Add claude-fable-5 support: native structured outputs via the @ai-sdk/anthropic bump, adaptive thinking (including the new "xhigh" effort) on the agent path, the API's built-in server-side refusal fallback to claude-opus-4-8, and auto tool choice for the final done call on models that reject forced tool use.

- [#2233](https://github.com/browserbase/stagehand/pull/2233) [`8d7d414`](https://github.com/browserbase/stagehand/commit/8d7d414c70676a31ea9322073f514d5b9dd5ecb1) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - Normalize URLs in `ActCache` key derivation by sorting query parameters before hashing. Semantically equivalent URLs that differ only in parameter order (e.g. `?utm_source=email&id=42` vs `?id=42&utm_source=email`) now hit the cache instead of silently missing. Fragments and duplicate keys are preserved.

- [#2229](https://github.com/browserbase/stagehand/pull/2229) [`fd42e65`](https://github.com/browserbase/stagehand/commit/fd42e65bb84825bdb7341a4953472db1ff774989) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - launch local browser with --enable-features=WebMCPTesting,DevToolsWebMCPSupport by default

- [#2220](https://github.com/browserbase/stagehand/pull/2220) [`a64c6b7`](https://github.com/browserbase/stagehand/commit/a64c6b74cfce7341ad4bbb2d39ae22c082f5f61e) Thanks [@monadoid](https://github.com/monadoid)! - Fix Stagehand-generated shadow-root XPath resolution so deterministic actions can target elements inside web components.

- [#2132](https://github.com/browserbase/stagehand/pull/2132) [`ed3e566`](https://github.com/browserbase/stagehand/commit/ed3e56636ee35b6eb2b1ad1af2bfb098a97aa39c) Thanks [@miguelg719](https://github.com/miguelg719)! - Add canonical verifier evidence normalization for screenshots and text signals without requiring image dependencies in core installs.

- [#2133](https://github.com/browserbase/stagehand/pull/2133) [`840aac8`](https://github.com/browserbase/stagehand/commit/840aac8bfcd9b3debcddffea0ca0c3de4670cf2a) Thanks [@miguelg719](https://github.com/miguelg719)! - Add the rubric-based verifier engine with normalized public rubric output and bounded failure-step parsing.

## 3.5.0

### Minor Changes

- [#2149](https://github.com/browserbase/stagehand/pull/2149) [`6e75725`](https://github.com/browserbase/stagehand/commit/6e75725b39898b3cbad681272009a69d94ca8238) Thanks [@miguelg719](https://github.com/miguelg719)! - Added a `screenshot` option to `extract()` that sends the current viewport screenshot with the a11y tree for extraction.

- [#2127](https://github.com/browserbase/stagehand/pull/2127) [`78bcde8`](https://github.com/browserbase/stagehand/commit/78bcde88e28f147acc6ca9aef9753cd96c870c35) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - Add `ignoreDefaultArgs` option to selectively remove chrome-launcher's built-in default flags (e.g. `--disable-extensions`) when running locally

- [#2160](https://github.com/browserbase/stagehand/pull/2160) [`49575d6`](https://github.com/browserbase/stagehand/commit/49575d62f56efbd3a91359a816823cbf70fde4fd) Thanks [@monadoid](https://github.com/monadoid)! - Forward constructor and request model configuration when initializing API-backed sessions.

- [#2171](https://github.com/browserbase/stagehand/pull/2171) [`dc1445d`](https://github.com/browserbase/stagehand/commit/dc1445df805cd3ad1f577278f978932244023a2e) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add native clipboard API

### Patch Changes

- [#2146](https://github.com/browserbase/stagehand/pull/2146) [`3a53ed4`](https://github.com/browserbase/stagehand/commit/3a53ed4ea97e079b295059a338f1ef8e768f8919) Thanks [@shriyatheunicorn](https://github.com/shriyatheunicorn)! - Pass local browser launch options through when attaching over CDP so explicit viewport settings are respected.

- [#2107](https://github.com/browserbase/stagehand/pull/2107) [`8fc16d2`](https://github.com/browserbase/stagehand/commit/8fc16d2e1845807103da6e62928b28e0de03ab90) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix Anthropic CUA `triple_click` action mapping.

- [#2118](https://github.com/browserbase/stagehand/pull/2118) [`3e95a87`](https://github.com/browserbase/stagehand/commit/3e95a8722a46bd7fca4d79644fe4605d7dc61bf6) Thanks [@monadoid](https://github.com/monadoid)! - Add Vertex auth parameters to the core and server API schemas.

- [#2126](https://github.com/browserbase/stagehand/pull/2126) [`ebbdcd3`](https://github.com/browserbase/stagehand/commit/ebbdcd33cbd137d36c9469c5ef0f531ee45a0bd8) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix(core): import ToolSet from ai public export

- [#2120](https://github.com/browserbase/stagehand/pull/2120) [`12703a6`](https://github.com/browserbase/stagehand/commit/12703a6659853e2afe2d28df71d8a9b916f9df65) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix structuredOutputMode for newer Anthropic models

- [#2170](https://github.com/browserbase/stagehand/pull/2170) [`1db5f1c`](https://github.com/browserbase/stagehand/commit/1db5f1c1937b3943e13d8a43cbdeee0a6906ff75) Thanks [@Kylejeong2](https://github.com/Kylejeong2)! - Add Claude Opus 4.8 to the supported CUA model whitelist.

- [#2116](https://github.com/browserbase/stagehand/pull/2116) [`cb586a1`](https://github.com/browserbase/stagehand/commit/cb586a14e46e616caa712afa6b7ceb4dc42b7fc6) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - include "[selected]" or "[checked]" state in snapshot

- [#2129](https://github.com/browserbase/stagehand/pull/2129) [`765861c`](https://github.com/browserbase/stagehand/commit/765861c04c46851663919277f330d27a87bae823) Thanks [@miguelg719](https://github.com/miguelg719)! - Add a backend-selectable v3 evaluator facade while preserving the legacy evaluator path.

- [#2157](https://github.com/browserbase/stagehand/pull/2157) [`2cd60a3`](https://github.com/browserbase/stagehand/commit/2cd60a34b0cfd7ae9399dd1a1779df096e86369b) Thanks [@miguelg719](https://github.com/miguelg719)! - Add verifier trajectory, rubric, and evaluation-result types with normalized public naming.

- [#2131](https://github.com/browserbase/stagehand/pull/2131) [`e102a89`](https://github.com/browserbase/stagehand/commit/e102a89c903d2f5badb335dd7b7f52f16b275151) Thanks [@miguelg719](https://github.com/miguelg719)! - Capture verifier trajectory evidence from agent evidence callbacks for offline scoring.

## 3.4.0

### Minor Changes

- [#2084](https://github.com/browserbase/stagehand/pull/2084) [`0641d44`](https://github.com/browserbase/stagehand/commit/0641d44a849062f5f7ce6a36a34ee95f9840efaa) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add ignoreSelectors param to extract()

- [#2096](https://github.com/browserbase/stagehand/pull/2096) [`a11603d`](https://github.com/browserbase/stagehand/commit/a11603d09d80f5e2fc341d154a0b90fe9fa48d1c) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add ignoreSelectors to observe()

### Patch Changes

- [#2080](https://github.com/browserbase/stagehand/pull/2080) [`21c78b3`](https://github.com/browserbase/stagehand/commit/21c78b3a50fd20cbec7ca8aa5f766f55e17b0f78) Thanks [@miguelg719](https://github.com/miguelg719)! - Add variables support to v3 agentExecute API schema and remove experimental requirement

- [#2077](https://github.com/browserbase/stagehand/pull/2077) [`f437f73`](https://github.com/browserbase/stagehand/commit/f437f738d23951cf460a30d3d285d1eba4c78ea2) Thanks [@monadoid](https://github.com/monadoid)! - Fix frame registry handling for OOPIF pages

- [#2098](https://github.com/browserbase/stagehand/pull/2098) [`a783b99`](https://github.com/browserbase/stagehand/commit/a783b99fb947968b685050314bd1df256d7a1f5a) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - bump transitive deps to patched versions

- [#2089](https://github.com/browserbase/stagehand/pull/2089) [`8d2f354`](https://github.com/browserbase/stagehand/commit/8d2f3541427ca7c9c6d9a831601a6a5babc48502) Thanks [@shrey150](https://github.com/shrey150)! - Strengthen observe prompts so LLMs return complete encoded element IDs.

- [#2047](https://github.com/browserbase/stagehand/pull/2047) [`a87c1fc`](https://github.com/browserbase/stagehand/commit/a87c1fc435be83dbf14eab9edc6c421454ef7be4) Thanks [@tkattkat](https://github.com/tkattkat)! - Set default agent mode to hybrid with auto routing to dom for non compatible models

- [#2101](https://github.com/browserbase/stagehand/pull/2101) [`26e6c96`](https://github.com/browserbase/stagehand/commit/26e6c960ca2894dc459ca40c9f31eb01e6d92053) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - move playwright-core, puppeteer-core, patchright-core from optional dependencies to peer dependencies

- [#2068](https://github.com/browserbase/stagehand/pull/2068) [`1d176c4`](https://github.com/browserbase/stagehand/commit/1d176c466e25eb0cb03d9986b51d5cdb35a2e56b) Thanks [@filip-michalsky](https://github.com/filip-michalsky)! - Remove the default temperature setting from v3 agent AI SDK calls so reasoning models that do not support temperature run without provider warnings.

- [#2040](https://github.com/browserbase/stagehand/pull/2040) [`1fa9613`](https://github.com/browserbase/stagehand/commit/1fa96130abbee2197a4e7f208878d06cba10c70b) Thanks [@monadoid](https://github.com/monadoid)! - Prefer `STAGEHAND_API_URL` for Stagehand API overrides while retaining `STAGEHAND_BASE_URL` as a deprecated fallback.

- [#2065](https://github.com/browserbase/stagehand/pull/2065) [`9ff70dd`](https://github.com/browserbase/stagehand/commit/9ff70dd26cf4e03dce00ddcdc2d3b5e8d116781c) Thanks [@miguelg719](https://github.com/miguelg719)! - Add support for CUA models: openai/gpt-5.4-mini, openai/gpt-5.5, and anthropic/claude-haiku-4-5

- [#2039](https://github.com/browserbase/stagehand/pull/2039) [`7640381`](https://github.com/browserbase/stagehand/commit/76403819b8f33d8d2670b6bea521a76f5ecc274e) Thanks [@monadoid](https://github.com/monadoid)! - Deprecate Browserbase project ID configuration.

## 3.3.0

### Minor Changes

- [#1980](https://github.com/browserbase/stagehand/pull/1980) [`e471d2e`](https://github.com/browserbase/stagehand/commit/e471d2e89d41bac4e9b907ee9c0d7adc36828104) Thanks [@shrey150](https://github.com/shrey150)! - Support Browserbase verified session settings and bump the Browserbase SDK.

### Patch Changes

- [#1954](https://github.com/browserbase/stagehand/pull/1954) [`732b384`](https://github.com/browserbase/stagehand/commit/732b3840f1631210dad2c720ec567e15e69ed304) Thanks [@github-actions](https://github.com/apps/github-actions)! - Update Anthropic CUA to use adaptive thinking

- [#2001](https://github.com/browserbase/stagehand/pull/2001) [`20b601d`](https://github.com/browserbase/stagehand/commit/20b601dc8779a1bacf66abb68ebdf276a238e5db) Thanks [@shrey150](https://github.com/shrey150)! - Include `agent.execute()` usage in `stagehand.metrics` for API-backed sessions.

- [#1983](https://github.com/browserbase/stagehand/pull/1983) [`8543c11`](https://github.com/browserbase/stagehand/commit/8543c11f6b4816f5c94fefdc8083f3616b987b22) Thanks [@github-actions](https://github.com/apps/github-actions)! - Add variable substitution to the keys tool in both live execution and cache replay paths. When keys steps with `method="type"` contain `%variableName%` tokens, they are now resolved against the provided variables. This brings the keys tool to parity with the type tool's variable handling.

- [#1973](https://github.com/browserbase/stagehand/pull/1973) [`14b64ec`](https://github.com/browserbase/stagehand/commit/14b64ec7d226a3eb0ce1c19937f14581e61b7a85) Thanks [@monadoid](https://github.com/monadoid)! - Enable strict structured outputs for supported model paths.

- [#2028](https://github.com/browserbase/stagehand/pull/2028) [`a500de1`](https://github.com/browserbase/stagehand/commit/a500de15cc010db3e42a7a05b7bcc92d2a9ad1d8) Thanks [@tkattkat](https://github.com/tkattkat)! - Remove deprecated provider option

- [#1975](https://github.com/browserbase/stagehand/pull/1975) [`8f7192c`](https://github.com/browserbase/stagehand/commit/8f7192cee912268a125caf53bbaf2c6ba0f0947f) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - make file upload elements more explicit in page snapshot

## 3.2.1

### Patch Changes

- [#1843](https://github.com/browserbase/stagehand/pull/1843) [`144e18e`](https://github.com/browserbase/stagehand/commit/144e18e9e0334ad3bc23aea6f4f7e181e0e6b9f0) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - apply user defined toolTimeout to all agent tools (other than wait & think tools)

- [#1872](https://github.com/browserbase/stagehand/pull/1872) [`d3c3736`](https://github.com/browserbase/stagehand/commit/d3c3736c579a78dfee8f7ad0ed4a299bfad70c41) Thanks [@tkattkat](https://github.com/tkattkat)! - Add support for LLM provider middleware

- [#1953](https://github.com/browserbase/stagehand/pull/1953) [`5c889df`](https://github.com/browserbase/stagehand/commit/5c889dfef9659a1f57f4de641c2d4e79208a159a) Thanks [@github-actions](https://github.com/apps/github-actions)! - (NEW) Model Gateway: make model api key optional on API

- [#1924](https://github.com/browserbase/stagehand/pull/1924) [`a1ab39e`](https://github.com/browserbase/stagehand/commit/a1ab39e7aa805ac739d7bfa39dce9a2680bb1b17) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix issue where stagehand could not attach to new tabs that were created manually.

- [#1874](https://github.com/browserbase/stagehand/pull/1874) [`f3fe7ce`](https://github.com/browserbase/stagehand/commit/f3fe7ce59743be8b5bdd070f749af7a9c6e84f19) Thanks [@miguelg719](https://github.com/miguelg719)! - Add headers (LLM) to ModelConfig

- [#1964](https://github.com/browserbase/stagehand/pull/1964) [`5fb9785`](https://github.com/browserbase/stagehand/commit/5fb9785357fb724274bc615a226fe13c93d5ccb2) Thanks [@github-actions](https://github.com/apps/github-actions)! - chore: update examples

- [#1901](https://github.com/browserbase/stagehand/pull/1901) [`f5d1f1f`](https://github.com/browserbase/stagehand/commit/f5d1f1ff8072fa4acf979bc63f491c775a48991d) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - pass timeout as timeoutMs in goto()

- [#1858](https://github.com/browserbase/stagehand/pull/1858) [`8bf5db8`](https://github.com/browserbase/stagehand/commit/8bf5db8eb8c69ce46fb8467d4216befe3a247f5b) Thanks [@monadoid](https://github.com/monadoid)! - Add explicit SSE event names for local v3 streaming and update the generated SDK contract to match.

- [#1899](https://github.com/browserbase/stagehand/pull/1899) [`6dc2276`](https://github.com/browserbase/stagehand/commit/6dc2276144ed48456a2b3e6525c5be47fa4eda18) Thanks [@tkattkat](https://github.com/tkattkat)! - fix: include screenshot in openai cua agents first message

## 3.2.0

### Minor Changes

- [#1779](https://github.com/browserbase/stagehand/pull/1779) [`2f43ffa`](https://github.com/browserbase/stagehand/commit/2f43ffac11778152d17e4c44405770cc32c3ec8c) Thanks [@shrey150](https://github.com/shrey150)! - feat: add `cdpHeaders` option to `localBrowserLaunchOptions` for passing custom HTTP headers when connecting to an existing browser via CDP URL

- [#1834](https://github.com/browserbase/stagehand/pull/1834) [`63ee247`](https://github.com/browserbase/stagehand/commit/63ee247ac6bf2992046d4f6b2759f46b15643e36) Thanks [@tkattkat](https://github.com/tkattkat)! - Update stagehand agents search tool

- [#1774](https://github.com/browserbase/stagehand/pull/1774) [`521a10e`](https://github.com/browserbase/stagehand/commit/521a10e3698fc5631e219947bc90dad0f8bddaa8) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add new page.setExtraHTTPHeaders() method

### Patch Changes

- [#1759](https://github.com/browserbase/stagehand/pull/1759) [`505e8c6`](https://github.com/browserbase/stagehand/commit/505e8c6736f3706328dbc8df670c49a018058388) Thanks [@shrey150](https://github.com/shrey150)! - Add bedrock to the provider enum in model configuration schemas and regenerate OpenAPI spec.

- [#1814](https://github.com/browserbase/stagehand/pull/1814) [`7dc35f5`](https://github.com/browserbase/stagehand/commit/7dc35f5e25689e6518d68b25ef71536d2781c8aa) Thanks [@tkattkat](https://github.com/tkattkat)! - Change usage of openai provider in agent to default to store:false

- [#1846](https://github.com/browserbase/stagehand/pull/1846) [`335cf47`](https://github.com/browserbase/stagehand/commit/335cf4730e73bce33e92331d04bda4b0fd42685d) Thanks [@aq17](https://github.com/aq17)! - Fix streaming finished event being silently dropped. The final SSE event containing the result payload (success status, message, actions, usage, and messages) was previously discarded instead of being yielded to the caller.

- [#1764](https://github.com/browserbase/stagehand/pull/1764) [`6ba0a1d`](https://github.com/browserbase/stagehand/commit/6ba0a1db7fc2d5d5a2f8927b1417d8f1d15eda10) Thanks [@shrey150](https://github.com/shrey150)! - Expose `headers` in `GoogleVertexProviderSettings` so model configs can pass custom provider headers (for example `X-Goog-Priority`) without TypeScript errors.

- [#1847](https://github.com/browserbase/stagehand/pull/1847) [`4ff3bb8`](https://github.com/browserbase/stagehand/commit/4ff3bb831a6ef6e2d57148e7afb68ea8d23e395d) Thanks [@miguelg719](https://github.com/miguelg719)! - Enable FlowLogger on BROWSERBASE_FLOW_LOGS=1

- [#1752](https://github.com/browserbase/stagehand/pull/1752) [`c27054b`](https://github.com/browserbase/stagehand/commit/c27054bbd0508431ade91d655f89efc87bbf5867) Thanks [@derekmeegan](https://github.com/derekmeegan)! - fix: pause Browserbase agents while captcha solving is active and improve CUA recovery after the solve completes

- [#1800](https://github.com/browserbase/stagehand/pull/1800) [`2abf5b9`](https://github.com/browserbase/stagehand/commit/2abf5b90f1e2bb1442509ef3a686b6128c9cdcf6) Thanks [@shrey150](https://github.com/shrey150)! - Make projectId optional for Browserbase sessions — only BROWSERBASE_API_KEY is required

- [#1766](https://github.com/browserbase/stagehand/pull/1766) [`7817fcc`](https://github.com/browserbase/stagehand/commit/7817fcc315eee4455ce04567cf56c9ec801caf0b) Thanks [@tkattkat](https://github.com/tkattkat)! - Add configurable timeout to tools in agent

- [#1749](https://github.com/browserbase/stagehand/pull/1749) [`7390508`](https://github.com/browserbase/stagehand/commit/73905088c5ed5923d276da9cce2efd0a0a3a46eb) Thanks [@pirate](https://github.com/pirate)! - When connecting to a browser session that has zero open tabs, Stagehand now automatically creates an initial `about:blank` tab so the connection can continue.

- [#1761](https://github.com/browserbase/stagehand/pull/1761) [`611f43a`](https://github.com/browserbase/stagehand/commit/611f43ac8d4c580216d55d2b217c14a9a9c11013) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix issue where handlePossibleNavigation was producing unnecessary error logs on clicks that trigger page close

- [#1817](https://github.com/browserbase/stagehand/pull/1817) [`2402a3c`](https://github.com/browserbase/stagehand/commit/2402a3c4d50270391b3e6440f4385cdcf5e1eb64) Thanks [@tkattkat](https://github.com/tkattkat)! - Add support for passing custom headers in clientOptions

## 3.1.0

### Minor Changes

- [#1681](https://github.com/browserbase/stagehand/pull/1681) [`e3db9aa`](https://github.com/browserbase/stagehand/commit/e3db9aa863f44270792215801fe6e3a02a1321aa) Thanks [@tkattkat](https://github.com/tkattkat)! - Add cookie management APIs: `context.addCookies()`, `context.clearCookies()`, & `context.cookies()`

- [#1672](https://github.com/browserbase/stagehand/pull/1672) [`b65756e`](https://github.com/browserbase/stagehand/commit/b65756e9e85643055446aa4a51956f7d6627c89f) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add boolean keepAlive parameter to allow for configuring whether the browser should be closed when stagehand.close() is called.

- [#1708](https://github.com/browserbase/stagehand/pull/1708) [`176d420`](https://github.com/browserbase/stagehand/commit/176d42002cc0a2c7d13b4c0ffbbd56b70fdc49e8) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add context.setExtraHTTPHeaders()

- [#1611](https://github.com/browserbase/stagehand/pull/1611) [`8a3c066`](https://github.com/browserbase/stagehand/commit/8a3c06600a9ba98485db7e9ed5c3cc43ea180334) Thanks [@monadoid](https://github.com/monadoid)! - Using `mode` enum instead of old `cua` boolean in openapi spec

### Patch Changes

- [#1683](https://github.com/browserbase/stagehand/pull/1683) [`7584f3e`](https://github.com/browserbase/stagehand/commit/7584f3e92e60a557d2b3e0e0d2a2af04c3527523) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: include shadow DOM in .count() & .nth() & support xpath predicates

- [#1644](https://github.com/browserbase/stagehand/pull/1644) [`1e1c9c1`](https://github.com/browserbase/stagehand/commit/1e1c9c15773e49d5c3cd36021dbc1d23495c1bce) Thanks [@monadoid](https://github.com/monadoid)! - Fix unhandled CDP detaches by returning the original sendCDP promise

- [#1729](https://github.com/browserbase/stagehand/pull/1729) [`6bef890`](https://github.com/browserbase/stagehand/commit/6bef89090ebd231e77d8092b2c32a0f06303d5a9) Thanks [@shrey150](https://github.com/shrey150)! - fix: support Claude 4.6 (Opus and Sonnet) in CUA mode by using the correct `computer_20251124` tool version and `computer-use-2025-11-24` beta header

- [#1647](https://github.com/browserbase/stagehand/pull/1647) [`ffd4b33`](https://github.com/browserbase/stagehand/commit/ffd4b335a873d0f4dcd76ea22d44f47919bf8e49) Thanks [@tkattkat](https://github.com/tkattkat)! - Fix [Agent] - Address bug causing issues with continuing a conversation from past messages in dom mode

- [#1614](https://github.com/browserbase/stagehand/pull/1614) [`677bff5`](https://github.com/browserbase/stagehand/commit/677bff5834c879a2d95f7dbff918b8e1510516b3) Thanks [@miguelg719](https://github.com/miguelg719)! - Enforce <number>-<number> regex validation on act/observe for elementId

- [#1580](https://github.com/browserbase/stagehand/pull/1580) [`65ff464`](https://github.com/browserbase/stagehand/commit/65ff464bc13388eb109eba0a2cf533c1cc202854) Thanks [@tkattkat](https://github.com/tkattkat)! - Add unified variables support across act and agent with a single VariableValue type

- [#1666](https://github.com/browserbase/stagehand/pull/1666) [`101bcf2`](https://github.com/browserbase/stagehand/commit/101bcf2da8b527fd6ace6aa291ada5d0f2d90344) Thanks [@Kylejeong2](https://github.com/Kylejeong2)! - add support for codex models

- [#1728](https://github.com/browserbase/stagehand/pull/1728) [`0a94301`](https://github.com/browserbase/stagehand/commit/0a94301caa991d1aa4cdade6e28a065b1aefb3e2) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - handle potential race condition on `.close()` when using the Stagehand API

- [#1664](https://github.com/browserbase/stagehand/pull/1664) [`b27c04d`](https://github.com/browserbase/stagehand/commit/b27c04d278c290364347acd0c354a878ea9b7c2d) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fixes issue with context.addInitScript() where scripts were not being applied to out of process iframes (OOPIFs), and popup pages with same process iframes (SPIFs)

- [#1632](https://github.com/browserbase/stagehand/pull/1632) [`afbd08b`](https://github.com/browserbase/stagehand/commit/afbd08bb6367a9c9f65f67e453667987e4659918) Thanks [@pirate](https://github.com/pirate)! - Remove automatic `.env` loading via `dotenv`.

  If your app relies on `.env` files, install `dotenv` and load it explicitly in your code:

  ```ts
  import dotenv from "dotenv";
  dotenv.config({ path: ".env" });
  ```

- [#1624](https://github.com/browserbase/stagehand/pull/1624) [`0e8d569`](https://github.com/browserbase/stagehand/commit/0e8d5695f662040f7384e64f46301152802e3c62) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix issue where screenshot masks were not being applied to dialog elements

- [#1596](https://github.com/browserbase/stagehand/pull/1596) [`ff0f979`](https://github.com/browserbase/stagehand/commit/ff0f9795f3b2c1cf4f2610a80ebcb3341a24f987) Thanks [@tkattkat](https://github.com/tkattkat)! - Update usage/metrics handling in agent

- [#1631](https://github.com/browserbase/stagehand/pull/1631) [`2d89d2b`](https://github.com/browserbase/stagehand/commit/2d89d2b35ce812431956b28e0c8b52d32ddc7a27) Thanks [@miguelg719](https://github.com/miguelg719)! - Add right and middle click support to act and observe

- [#1697](https://github.com/browserbase/stagehand/pull/1697) [`aac9a19`](https://github.com/browserbase/stagehand/commit/aac9a19bdfbe62e4508631337ab0bfbcf8ae62b2) Thanks [@shrey150](https://github.com/shrey150)! - fix: support `<frame>` elements in XPath frame boundary detection so `act()` works on legacy `<frameset>` pages

- [#1692](https://github.com/browserbase/stagehand/pull/1692) [`06de50f`](https://github.com/browserbase/stagehand/commit/06de50ff377fd31f1b0fcf79adb996d04562d2c0) Thanks [@shrey150](https://github.com/shrey150)! - fix: skip piercer injection for chrome-extension:// and other non-HTML targets

- [#1613](https://github.com/browserbase/stagehand/pull/1613) [`aa4d981`](https://github.com/browserbase/stagehand/commit/aa4d981e440bdd0e3d3f42ccc310d5958aa25cc6) Thanks [@miguelg719](https://github.com/miguelg719)! - SupportedUnderstudyAction Enum validation for 'method' on act/observe inference

- [#1652](https://github.com/browserbase/stagehand/pull/1652) [`18b1e3b`](https://github.com/browserbase/stagehand/commit/18b1e3bd2b16b721845d52fcf1a45c6158e2403f) Thanks [@miguelg719](https://github.com/miguelg719)! - Add support for gemini 3 flash and pro in hybrid/cua agent

- [#1706](https://github.com/browserbase/stagehand/pull/1706) [`957d82b`](https://github.com/browserbase/stagehand/commit/957d82b9845b4413b123539e81a2e4a490e74a8a) Thanks [@chrisreadsf](https://github.com/chrisreadsf)! - Add GLM to prompt-based JSON fallback for models without native structured output support

- [#1633](https://github.com/browserbase/stagehand/pull/1633) [`22e371a`](https://github.com/browserbase/stagehand/commit/22e371ae4c25deb6350328fe02832bf2b2197b94) Thanks [@tkattkat](https://github.com/tkattkat)! - Add warning when incorrect models are used with agents hybrid mode

- [#1673](https://github.com/browserbase/stagehand/pull/1673) [`d29b91f`](https://github.com/browserbase/stagehand/commit/d29b91fa506636ca36f724fcf106320de54ec3f3) Thanks [@miguelg719](https://github.com/miguelg719)! - Add multi-region support for Stagehand API with region-specific endpoints

- [#1695](https://github.com/browserbase/stagehand/pull/1695) [`7b4f817`](https://github.com/browserbase/stagehand/commit/7b4f817cafb9829ac81c4b5890c318c7f9521fe4) Thanks [@tkattkat](https://github.com/tkattkat)! - Fix: zod bug when pinning zod to v3 and using structured output in agent

- [#1609](https://github.com/browserbase/stagehand/pull/1609) [`3f9ca4d`](https://github.com/browserbase/stagehand/commit/3f9ca4d9acc109101357378d29cf969168991608) Thanks [@miguelg719](https://github.com/miguelg719)! - Add SupportedUnderstudyActions to observe system prompt

- [#1581](https://github.com/browserbase/stagehand/pull/1581) [`49ead1e`](https://github.com/browserbase/stagehand/commit/49ead1e1e8678a8da0f87ad2042491dacc6b01d7) Thanks [@sameelarif](https://github.com/sameelarif)! - **Server-side caching is now available.**

  When running `env: "BROWSERBASE"`, Stagehand automatically caches `act()`, `extract()`, and `observe()` results server-side — repeated calls with the same inputs return instantly without consuming LLM tokens.

  Caching is enabled by default and can be disabled via `serverCache: false` on the Stagehand instance or per individual call. Check out the [browserbase blog](https://www.browserbase.com/blog/stagehand-caching) for more details.

- [#1642](https://github.com/browserbase/stagehand/pull/1642) [`3673369`](https://github.com/browserbase/stagehand/commit/36733691f90c15386cf2a7b47d04ef429b7195ae) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix issue where scripts added via context.addInitScripts() were not being injected into new pages that were opened via popups (eg, clicking a link that opens a new page) and/or calling context.newPage(url)

- [#1735](https://github.com/browserbase/stagehand/pull/1735) [`c465e87`](https://github.com/browserbase/stagehand/commit/c465e87ab41942435132c76338518fb3fa8e7896) Thanks [@monadoid](https://github.com/monadoid)! - Supports request header authentication with connectToMCPServer

- [#1705](https://github.com/browserbase/stagehand/pull/1705) [`ae533e4`](https://github.com/browserbase/stagehand/commit/ae533e40195181b53833f8055b1259fb360a927b) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - include error cause in UnderstudyCommandException

- [#1636](https://github.com/browserbase/stagehand/pull/1636) [`ea33052`](https://github.com/browserbase/stagehand/commit/ea330520a325583b71b87d85beb740df4bdb9b2d) Thanks [@miguelg719](https://github.com/miguelg719)! - Include executionModel on the AgentConfigSchema

- [#1679](https://github.com/browserbase/stagehand/pull/1679) [`5764ede`](https://github.com/browserbase/stagehand/commit/5764edee7aab00ef1aafafb68fc56eb26c0a70b2) Thanks [@shrey150](https://github.com/shrey150)! - fix issue where locator.count() was not working with xpaths that have attribute predicates

- [#1646](https://github.com/browserbase/stagehand/pull/1646) [`f09b184`](https://github.com/browserbase/stagehand/commit/f09b184cc5e774736280ae8c94ba3f4f13adda80) Thanks [@miguelg719](https://github.com/miguelg719)! - Add user-agent to CDP connections

- [#1637](https://github.com/browserbase/stagehand/pull/1637) [`a7d29de`](https://github.com/browserbase/stagehand/commit/a7d29decee0f7d12e2437267b9eef1795d3b4e3a) Thanks [@miguelg719](https://github.com/miguelg719)! - Improve error and warning message for legacy model format

- [#1685](https://github.com/browserbase/stagehand/pull/1685) [`d334399`](https://github.com/browserbase/stagehand/commit/d3343990041bf9cd5613569840afb0c17131e33c) Thanks [@tkattkat](https://github.com/tkattkat)! - Bump ai sdk & google provider version

- [#1662](https://github.com/browserbase/stagehand/pull/1662) [`44416da`](https://github.com/browserbase/stagehand/commit/44416da7ff33301bb32d3811e6c3be8782a7d168) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix issue where locator.fill() was not working on elements that require direct value setting

- [#1612](https://github.com/browserbase/stagehand/pull/1612) [`bdd8b4e`](https://github.com/browserbase/stagehand/commit/bdd8b4ee3c697a02728375510ab7fae764990576) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix issue where screenshot mask was only being applied to the first element that the locator resolved to. masks now apply to all matching elements.

## 3.0.8

### Patch Changes

- [#1514](https://github.com/browserbase/stagehand/pull/1514) [`40ce5cc`](https://github.com/browserbase/stagehand/commit/40ce5cc83ec758f4e8c37132a7f4ac8eeea7ca34) Thanks [@tkattkat](https://github.com/tkattkat)! - Rename the close tool in agent to "done"

- [#1574](https://github.com/browserbase/stagehand/pull/1574) [`5506f41`](https://github.com/browserbase/stagehand/commit/5506f416d2609d112b553263984e21d7a30e32b1) Thanks [@tkattkat](https://github.com/tkattkat)! - fix(server): pass cdpUrl to localBrowserLaunchOptions when launchOptions absent

- [#1521](https://github.com/browserbase/stagehand/pull/1521) [`84c05ca`](https://github.com/browserbase/stagehand/commit/84c05ca8de4587181faf128e5c7464fd960caacc) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: get agent cache working in API mode

- [#1486](https://github.com/browserbase/stagehand/pull/1486) [`692ffa0`](https://github.com/browserbase/stagehand/commit/692ffa0346ad3d121686aba503c0a22844293efa) Thanks [@tkattkat](https://github.com/tkattkat)! - improve logging in agent

- [#1551](https://github.com/browserbase/stagehand/pull/1551) [`1ef8901`](https://github.com/browserbase/stagehand/commit/1ef8901e1314e90f43b36be20192e652d3b5598f) Thanks [@miguelg719](https://github.com/miguelg719)! - move extract handler response log to after URL injection

- [#1495](https://github.com/browserbase/stagehand/pull/1495) [`72ac775`](https://github.com/browserbase/stagehand/commit/72ac775a831d6f0f376ceda4426525f93cc21452) Thanks [@tkattkat](https://github.com/tkattkat)! - export tool function & type to simplify defining custom tools

- [#1481](https://github.com/browserbase/stagehand/pull/1481) [`3d5af07`](https://github.com/browserbase/stagehand/commit/3d5af07f66d6d26d1f5ac4bd9be7183c3381dd92) Thanks [@tkattkat](https://github.com/tkattkat)! - add waitForTimeout to page

- [#1423](https://github.com/browserbase/stagehand/pull/1423) [`40e1d80`](https://github.com/browserbase/stagehand/commit/40e1d80776b9216422a25a81070ccb3105e56ec2) Thanks [@miguelg719](https://github.com/miguelg719)! - Improve benchmark handling and add metadata

- [#1588](https://github.com/browserbase/stagehand/pull/1588) [`56c0d24`](https://github.com/browserbase/stagehand/commit/56c0d244f9b2431218bfa832ddfc0587930ae038) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add SnapshotOptions to page.snapshot()

- [#1483](https://github.com/browserbase/stagehand/pull/1483) [`16d72fb`](https://github.com/browserbase/stagehand/commit/16d72fb4c4081dd33bf45605d75c27644ea4c00e) Thanks [@tkattkat](https://github.com/tkattkat)! - Optimize screenshot handling in agent hybrid mode

- [#1498](https://github.com/browserbase/stagehand/pull/1498) [`088c4cc`](https://github.com/browserbase/stagehand/commit/088c4cc31dc924bb232a9d5a09ab42cd961c2d36) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: replaying cached actions (for agent & act) now uses the originally defined model, (instead of default model) when action fails and rerunning inference is needed

- [#1575](https://github.com/browserbase/stagehand/pull/1575) [`4276f4a`](https://github.com/browserbase/stagehand/commit/4276f4abc8bbde215faac6c0321bf243484c376b) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - expose port param in localBrowserLaunchOptions

- [#1544](https://github.com/browserbase/stagehand/pull/1544) [`6005786`](https://github.com/browserbase/stagehand/commit/600578637e65f6fd18b0cdb322b9e0b857708b2f) Thanks [@tkattkat](https://github.com/tkattkat)! - Recommend hybrid mode over DOM mode in agent, which is now considered legacy

- [#1505](https://github.com/browserbase/stagehand/pull/1505) [`6fbf5fc`](https://github.com/browserbase/stagehand/commit/6fbf5fc811e5e5d9d22f10c5309fbd336892263a) Thanks [@tkattkat](https://github.com/tkattkat)! - Add structured output to agent result + ensure close tool is always called

- [#1511](https://github.com/browserbase/stagehand/pull/1511) [`704cf18`](https://github.com/browserbase/stagehand/commit/704cf18cb2bdd187ba06c35f05ccb47317a7668c) Thanks [@shrey150](https://github.com/shrey150)! - Fix ControlOrMeta keypress event

- [#1480](https://github.com/browserbase/stagehand/pull/1480) [`091296e`](https://github.com/browserbase/stagehand/commit/091296e438bb2374c8bb10ef6c08283978145ebf) Thanks [@tkattkat](https://github.com/tkattkat)! - Update agent to only calculate xpath when caching is enabled

- [#1509](https://github.com/browserbase/stagehand/pull/1509) [`e56c6eb`](https://github.com/browserbase/stagehand/commit/e56c6eb139bf3aad37e98b16626fff13a6c671d0) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add support for page.waitForSelector()

- [#1478](https://github.com/browserbase/stagehand/pull/1478) [`2cb78d0`](https://github.com/browserbase/stagehand/commit/2cb78d0f5ddef9f7337a9a2fe3137f1421df700a) Thanks [@tkattkat](https://github.com/tkattkat)! - update agent message handling

- [#1518](https://github.com/browserbase/stagehand/pull/1518) [`5dad639`](https://github.com/browserbase/stagehand/commit/5dad63938f08d968d434bb1ee2804f1e54fb836a) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add page.snapshot() for capturing a stringified DOM snapshot of the page, including an xpath map & url map

- [#1576](https://github.com/browserbase/stagehand/pull/1576) [`b7c2571`](https://github.com/browserbase/stagehand/commit/b7c2571ad4ac563f3ca0518e1f29a40da93e33bc) Thanks [@tkattkat](https://github.com/tkattkat)! - utilize waitForSelector when running agent cache

- [#1560](https://github.com/browserbase/stagehand/pull/1560) [`4c69117`](https://github.com/browserbase/stagehand/commit/4c6911748953199dc9aad3eabe98bcf325f871e4) Thanks [@tkattkat](https://github.com/tkattkat)! - Update coordinate handling in cua and hybrid

## 3.0.7

### Patch Changes

- [#1461](https://github.com/browserbase/stagehand/pull/1461) [`0f3991e`](https://github.com/browserbase/stagehand/commit/0f3991eedc0aaff72ef718dda3ddb0839cf4a464) Thanks [@tkattkat](https://github.com/tkattkat)! - Move hybrid mode out of experimental

- [#1433](https://github.com/browserbase/stagehand/pull/1433) [`e0e22e0`](https://github.com/browserbase/stagehand/commit/e0e22e06bc752a8ffde30f3dbfa58d91e24e6c09) Thanks [@tkattkat](https://github.com/tkattkat)! - Put hybrid mode behind experimental

- [#1456](https://github.com/browserbase/stagehand/pull/1456) [`f261051`](https://github.com/browserbase/stagehand/commit/f2610517d74774374de9ee93191e663439ef55e5) Thanks [@shrey150](https://github.com/shrey150)! - Invoke page.hover for agent move action

- [#1473](https://github.com/browserbase/stagehand/pull/1473) [`e021674`](https://github.com/browserbase/stagehand/commit/e021674f9641c1c5f9d0c1817c3fdf599eea124d) Thanks [@shrey150](https://github.com/shrey150)! - Add safety confirmation support for OpenAI + Google CUA

- [#1399](https://github.com/browserbase/stagehand/pull/1399) [`6a5496f`](https://github.com/browserbase/stagehand/commit/6a5496f17dbb716be1ee1aaa4e5ba9d8c723b30b) Thanks [@tkattkat](https://github.com/tkattkat)! - Ensure cua agent is killed when stagehand.close is called

- [#1436](https://github.com/browserbase/stagehand/pull/1436) [`fea1700`](https://github.com/browserbase/stagehand/commit/fea1700552af3319052f463685752501c8e71de3) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix auto-load key for act/extract/observe parametrized models on api

- [#1439](https://github.com/browserbase/stagehand/pull/1439) [`5b288d9`](https://github.com/browserbase/stagehand/commit/5b288d9ac37406ff22460ac8050bea26b87a378e) Thanks [@tkattkat](https://github.com/tkattkat)! - Remove base64 from agent actions array ( still present in messages object )

- [#1408](https://github.com/browserbase/stagehand/pull/1408) [`e822f5a`](https://github.com/browserbase/stagehand/commit/e822f5a8898df9eb48ca32c321025f0c74b638f0) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - allow for act() cache hit when variable values change

- [#1472](https://github.com/browserbase/stagehand/pull/1472) [`638efc7`](https://github.com/browserbase/stagehand/commit/638efc7fea401bc43dd05dceedf4c13a3495a728) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: agent cache not refreshed on action failure

- [#1424](https://github.com/browserbase/stagehand/pull/1424) [`a890f16`](https://github.com/browserbase/stagehand/commit/a890f16fa3a752f308f858e5ab9c9a0faf6b3b34) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: "Error: -32000 Failed to convert response to JSON: CBOR: stack limit exceeded"

- [#1418](https://github.com/browserbase/stagehand/pull/1418) [`934f492`](https://github.com/browserbase/stagehand/commit/934f492ec587bef81f0ce75b45a35b44ab545712) Thanks [@miguelg719](https://github.com/miguelg719)! - Cleanup handlers and bus listeners on close

- [#1430](https://github.com/browserbase/stagehand/pull/1430) [`bd2db92`](https://github.com/browserbase/stagehand/commit/bd2db925f66a826d61d58be1611d55646cbdb560) Thanks [@shrey150](https://github.com/shrey150)! - Fix CUA model coordinate translation

- [#1465](https://github.com/browserbase/stagehand/pull/1465) [`51e0170`](https://github.com/browserbase/stagehand/commit/51e01709ce1c947c1947b4e2cb0b1f4f97b77182) Thanks [@miguelg719](https://github.com/miguelg719)! - Add media resolution high provider option to gemini 3 hybrid agent

- [#1431](https://github.com/browserbase/stagehand/pull/1431) [`05f5580`](https://github.com/browserbase/stagehand/commit/05f5580937c3c157550e3c25ae6671f44f562211) Thanks [@tkattkat](https://github.com/tkattkat)! - Update the cache handling for agent

- [#1432](https://github.com/browserbase/stagehand/pull/1432) [`f56a9c2`](https://github.com/browserbase/stagehand/commit/f56a9c296d4ddce25a405358c66837f8ce4d679f) Thanks [@tkattkat](https://github.com/tkattkat)! - Deprecate cua: true in favor of mode: "cua"

- [#1406](https://github.com/browserbase/stagehand/pull/1406) [`b40ae11`](https://github.com/browserbase/stagehand/commit/b40ae11391af49c3581fce27faa1b7483fc4a169) Thanks [@tkattkat](https://github.com/tkattkat)! - Add support for hovering with coordinates ( page.hover )

- [#1407](https://github.com/browserbase/stagehand/pull/1407) [`0d2b398`](https://github.com/browserbase/stagehand/commit/0d2b398cd40b32a9ecaf28ede70853036b7c91bd) Thanks [@tkattkat](https://github.com/tkattkat)! - Clean up page methods

- [#1412](https://github.com/browserbase/stagehand/pull/1412) [`cd01f29`](https://github.com/browserbase/stagehand/commit/cd01f290578eac703521f801ba3712f5332918f3) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: load GOOGLE_API_KEY from .env

- [#1462](https://github.com/browserbase/stagehand/pull/1462) [`a734fca`](https://github.com/browserbase/stagehand/commit/a734fca0b4573753767d3ebc48ec414baf4f23e1) Thanks [@shrey150](https://github.com/shrey150)! - fix: correctly pass userDataDir to chrome launcher

- [#1466](https://github.com/browserbase/stagehand/pull/1466) [`b342acf`](https://github.com/browserbase/stagehand/commit/b342acfaae058127fb57664644c5fd965db02bf2) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - move playwright to optional dependencies

- [#1440](https://github.com/browserbase/stagehand/pull/1440) [`2987cd1`](https://github.com/browserbase/stagehand/commit/2987cd1e5ffabefa9411936609635d4a638faed5) Thanks [@tkattkat](https://github.com/tkattkat)! - [Feature] support excluding tools from agent

- [#1455](https://github.com/browserbase/stagehand/pull/1455) [`dfab1d5`](https://github.com/browserbase/stagehand/commit/dfab1d566299c8c5a63f20565a6da07dc8f61ccd) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - update aisdk client to better enforce structured output with deepseek models

- [#1428](https://github.com/browserbase/stagehand/pull/1428) [`4d71162`](https://github.com/browserbase/stagehand/commit/4d71162beb119635b69b17637564a2bbd0e373e7) Thanks [@tkattkat](https://github.com/tkattkat)! - Add "hybrid" mode to stagehand agent

## 3.0.6

### Patch Changes

- [#1388](https://github.com/browserbase/stagehand/pull/1388) [`605ed6b`](https://github.com/browserbase/stagehand/commit/605ed6b81a3ff8f25d4022f1e5fce6b42aecfc19) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix multiple click event dispatches on CDP and Anthropic CUA handling (double clicks)

- [#1400](https://github.com/browserbase/stagehand/pull/1400) [`34e7e5b`](https://github.com/browserbase/stagehand/commit/34e7e5b292f5e6af6efc0da60118663310c5f718) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - don't write base64 encoded screenshots to disk when caching agent actions

- [#1345](https://github.com/browserbase/stagehand/pull/1345) [`943d2d7`](https://github.com/browserbase/stagehand/commit/943d2d79d0f289ac41c9164578f2f1dd876058f2) Thanks [@tkattkat](https://github.com/tkattkat)! - Add support for aborting / stopping an agent run & continuing an agent run using messages from prior runs

- [#1334](https://github.com/browserbase/stagehand/pull/1334) [`0e95cd2`](https://github.com/browserbase/stagehand/commit/0e95cd2f67672f64f0017024fd47d8b3aef59a95) Thanks [@tkattkat](https://github.com/tkattkat)! - Add support for google vertex provider

- [#1410](https://github.com/browserbase/stagehand/pull/1410) [`d4237e4`](https://github.com/browserbase/stagehand/commit/d4237e40951ecd10abfdbe766672d498f8806484) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: include extract in stagehand.history()

- [#1315](https://github.com/browserbase/stagehand/pull/1315) [`86975e7`](https://github.com/browserbase/stagehand/commit/86975e795db7505804949a267b20509bd16b5256) Thanks [@tkattkat](https://github.com/tkattkat)! - Add streaming support to agent through stream:true in the agent config

- [#1304](https://github.com/browserbase/stagehand/pull/1304) [`d5e119b`](https://github.com/browserbase/stagehand/commit/d5e119be5eec84915a79f8d611b6ba0546f48c99) Thanks [@miguelg719](https://github.com/miguelg719)! - Add support for Microsoft's Fara-7B

- [#1346](https://github.com/browserbase/stagehand/pull/1346) [`4e051b2`](https://github.com/browserbase/stagehand/commit/4e051b23add7ae276b0dbead38b4587838cfc1c1) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: don't attach to targets twice

- [#1327](https://github.com/browserbase/stagehand/pull/1327) [`6b5a3c9`](https://github.com/browserbase/stagehand/commit/6b5a3c9035654caaed2da375085b465edda97de4) Thanks [@miguelg719](https://github.com/miguelg719)! - Informed error parsing from api

- [#1335](https://github.com/browserbase/stagehand/pull/1335) [`bb85ad9`](https://github.com/browserbase/stagehand/commit/bb85ad912738623a7a866f0cb6e8d5807c6c2738) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add support for page.addInitScript()

- [#1331](https://github.com/browserbase/stagehand/pull/1331) [`88d28cc`](https://github.com/browserbase/stagehand/commit/88d28cc6f31058d1cf6ec6dc948a4ae77a926b3c) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: page.evaluate() now works with scripts injected via context.addInitScript()

- [#1316](https://github.com/browserbase/stagehand/pull/1316) [`45bcef0`](https://github.com/browserbase/stagehand/commit/45bcef0e5788b083f9e38dfd7c3bc63afcd4b6dd) Thanks [@tkattkat](https://github.com/tkattkat)! - Add support for callbacks in stagehand agent

- [#1374](https://github.com/browserbase/stagehand/pull/1374) [`6aa9d45`](https://github.com/browserbase/stagehand/commit/6aa9d455aa5836ec2ee8ab2e8b9df3fb218e5381) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix key action mapping in Anthropic CUA

- [#1330](https://github.com/browserbase/stagehand/pull/1330) [`d382084`](https://github.com/browserbase/stagehand/commit/d382084745fff98c3e71413371466394a2625429) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: make act, extract, and observe respect user defined timeout param

- [#1336](https://github.com/browserbase/stagehand/pull/1336) [`1df08cc`](https://github.com/browserbase/stagehand/commit/1df08ccb0a2cf73b5c37a91c129721114ff6371c) Thanks [@tkattkat](https://github.com/tkattkat)! - Patch agent on api

- [#1358](https://github.com/browserbase/stagehand/pull/1358) [`2b56600`](https://github.com/browserbase/stagehand/commit/2b566009606fcbba987260f21b075b318690ce99) Thanks [@tkattkat](https://github.com/tkattkat)! - Add support for 4.5 opus in cua agent

## 3.0.4

### Patch Changes

- [#1281](https://github.com/browserbase/stagehand/pull/1281) [`fa18cfd`](https://github.com/browserbase/stagehand/commit/fa18cfdc45f28e35e6566587b54612396e6ece45) Thanks [@monadoid](https://github.com/monadoid)! - Add Browserbase session URL and debug URL accessors

- [#1264](https://github.com/browserbase/stagehand/pull/1264) [`767d168`](https://github.com/browserbase/stagehand/commit/767d1686285cf9c57675595f553f8a891f13c63b) Thanks [@Kylejeong2](https://github.com/Kylejeong2)! - feat: adding gpt 5.1 to stagehand

- [#1282](https://github.com/browserbase/stagehand/pull/1282) [`f27a99c`](https://github.com/browserbase/stagehand/commit/f27a99c11b020b33736fe67af8f7f0e663c6f45f) Thanks [@tkattkat](https://github.com/tkattkat)! - Add support for zod 4, while maintaining backwards compatibility for zod 3

- [#1295](https://github.com/browserbase/stagehand/pull/1295) [`91a1ca0`](https://github.com/browserbase/stagehand/commit/91a1ca07d9178c46269bfb951abb20a215eb7c29) Thanks [@tkattkat](https://github.com/tkattkat)! - Patch zod handling of non objects in extract

- [#1298](https://github.com/browserbase/stagehand/pull/1298) [`1dd7d43`](https://github.com/browserbase/stagehand/commit/1dd7d4330de9022dc6cd45a8b5c86cb9e1b575ec) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - log Browserbase session status when websocket is closed due to session timeout

- [#1284](https://github.com/browserbase/stagehand/pull/1284) [`c0f3b98`](https://github.com/browserbase/stagehand/commit/c0f3b98277c15c77b2b4c3f55503e61ef3d27cf3) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: waitForDomNetworkQuiet() causing `act()` to hang indefinitely

- [#1246](https://github.com/browserbase/stagehand/pull/1246) [`44bb4f5`](https://github.com/browserbase/stagehand/commit/44bb4f51dcccbdca8df07e4d7f8d28a7e6e793ec) Thanks [@filip-michalsky](https://github.com/filip-michalsky)! - make ci faster

- [#1300](https://github.com/browserbase/stagehand/pull/1300) [`2b70347`](https://github.com/browserbase/stagehand/commit/2b7034771bc6d6b1fabb13deaa56c299881b3728) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add support for context.addInitScript()

## 3.0.3

### Patch Changes

- [#1273](https://github.com/browserbase/stagehand/pull/1273) [`ab51232`](https://github.com/browserbase/stagehand/commit/ab51232db428be048957c0f5d67f2176eb7a5194) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: trigger shadow root rerender in OOPIFs by cloning & replacing instead of reloading

- [#1268](https://github.com/browserbase/stagehand/pull/1268) [`c76ade0`](https://github.com/browserbase/stagehand/commit/c76ade009ef81208accae6475ec4707d3906e566) Thanks [@tkattkat](https://github.com/tkattkat)! - Expose reasoning, and cached input tokens in stagehand metrics

- [#1267](https://github.com/browserbase/stagehand/pull/1267) [`ffb5e5d`](https://github.com/browserbase/stagehand/commit/ffb5e5d2ab49adcb2efdfc9e5c76e8c96268b5b3) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: file uploads failing on Browserbase

- [#1269](https://github.com/browserbase/stagehand/pull/1269) [`772e735`](https://github.com/browserbase/stagehand/commit/772e73543e45106d7fa0fafd95ade46ae11023bc) Thanks [@tkattkat](https://github.com/tkattkat)! - Add example using playwright screen recording

## 3.0.2

### Patch Changes

- [#1245](https://github.com/browserbase/stagehand/pull/1245) [`a224b33`](https://github.com/browserbase/stagehand/commit/a224b3371b6c1470baf342742fb745c7192b52c6) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - allow act() to call hover()

- [#1234](https://github.com/browserbase/stagehand/pull/1234) [`6fc9de2`](https://github.com/browserbase/stagehand/commit/6fc9de2a1079e4f2fb0b1633d8df0bb7a9f7f89f) Thanks [@miguelg719](https://github.com/miguelg719)! - Add a page.sendCDP method

- [#1233](https://github.com/browserbase/stagehand/pull/1233) [`4935be7`](https://github.com/browserbase/stagehand/commit/4935be788b3431527f3d110864c0fd7060cfaf7c) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - extend page.screenshot() options to mirror playwright

- [#1232](https://github.com/browserbase/stagehand/pull/1232) [`bdd76fc`](https://github.com/browserbase/stagehand/commit/bdd76fcd1e48079fc5ab8cf040ebb5997dfc6c99) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - export Page type

- [#1229](https://github.com/browserbase/stagehand/pull/1229) [`7ea18a4`](https://github.com/browserbase/stagehand/commit/7ea18a420fc033d1b72556db83a1f41735e5a022) Thanks [@tkattkat](https://github.com/tkattkat)! - Adjust extract tool + expose extract response in agent result

- [#1239](https://github.com/browserbase/stagehand/pull/1239) [`d4de014`](https://github.com/browserbase/stagehand/commit/d4de014235a18f9e1089240bc72e28cbfe77ca1c) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix stagehand.metrics on api mode

- [#1241](https://github.com/browserbase/stagehand/pull/1241) [`2d1b573`](https://github.com/browserbase/stagehand/commit/2d1b5732dc441a3331f5743cdfed3e1037d8b3b5) Thanks [@miguelg719](https://github.com/miguelg719)! - Return response on page.goto api mode

- [#1253](https://github.com/browserbase/stagehand/pull/1253) [`5556041`](https://github.com/browserbase/stagehand/commit/5556041e2deaed5012363303fd7a8ac00e3242cd) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix missing page issue when connecting to existing browser

- [#1235](https://github.com/browserbase/stagehand/pull/1235) [`7e4b43e`](https://github.com/browserbase/stagehand/commit/7e4b43ed46fbdd2074827e87d9a245e2dc96456b) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - make page.goto() return a Response object

- [#1254](https://github.com/browserbase/stagehand/pull/1254) [`7e72adf`](https://github.com/browserbase/stagehand/commit/7e72adfd7e4af5ec49ac2f552e7f1f57c1acc554) Thanks [@sameelarif](https://github.com/sameelarif)! - Added custom error types to allow for a smoother debugging experience.

- [#1227](https://github.com/browserbase/stagehand/pull/1227) [`9bf09d0`](https://github.com/browserbase/stagehand/commit/9bf09d041111870d71cb9ffcb3ac5fa2c4b1399d) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix readme's media links and add instructions for installing from a branch

- [#1257](https://github.com/browserbase/stagehand/pull/1257) [`92d32ea`](https://github.com/browserbase/stagehand/commit/92d32eafe91a4241615cc65501b8461c6074a02b) Thanks [@tkattkat](https://github.com/tkattkat)! - Add support for a custom baseUrl with google cua client

- [#1230](https://github.com/browserbase/stagehand/pull/1230) [`ebcf3a1`](https://github.com/browserbase/stagehand/commit/ebcf3a1ffa859374d71de4931c6a9b982a565e46) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add stagehand.browserbaseSessionID getter

- [#1262](https://github.com/browserbase/stagehand/pull/1262) [`c29a4f2`](https://github.com/browserbase/stagehand/commit/c29a4f2eca91ae2902ed9d48b2385b4436f7b664) Thanks [@miguelg719](https://github.com/miguelg719)! - Remove error throwing when api and experimental are both set

- [#1223](https://github.com/browserbase/stagehand/pull/1223) [`6d21efa`](https://github.com/browserbase/stagehand/commit/6d21efa8b30317aa3ce3e37ac6c2222af3b967b5) Thanks [@miguelg719](https://github.com/miguelg719)! - Disable api mode when using custom LLM clients

- [#1228](https://github.com/browserbase/stagehand/pull/1228) [`525ef0c`](https://github.com/browserbase/stagehand/commit/525ef0c1243aaf3452ee7e4ea81b4208f4c2efd1) Thanks [@Kylejeong2](https://github.com/Kylejeong2)! - update slack link in docs

- [#1226](https://github.com/browserbase/stagehand/pull/1226) [`9ddb872`](https://github.com/browserbase/stagehand/commit/9ddb872e350358214e12a91cf6a614fd2ec1f74c) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add support for page.on('console') events

## 3.0.1

### Patch Changes

- [#1207](https://github.com/browserbase/stagehand/pull/1207) [`55da8c6`](https://github.com/browserbase/stagehand/commit/55da8c6e9575cbad3246c55b17650cf6b293ddbe) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix broken links to quickstart docs

- [#1200](https://github.com/browserbase/stagehand/pull/1200) [`0a5ee63`](https://github.com/browserbase/stagehand/commit/0a5ee638bde051d109eb2266e665934a12f3dc31) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - log info when scope narrowing selector fails

- [#1205](https://github.com/browserbase/stagehand/pull/1205) [`ee76881`](https://github.com/browserbase/stagehand/commit/ee7688156cb67a9f0f90dfe0dbab77423693a332) Thanks [@miguelg719](https://github.com/miguelg719)! - Update README.md, add Changelog for v3

- [#1209](https://github.com/browserbase/stagehand/pull/1209) [`9e95add`](https://github.com/browserbase/stagehand/commit/9e95add37eb30db4f85e73df7760c7e63fb4131e) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix circular import in exported aisdk example client

- [#1211](https://github.com/browserbase/stagehand/pull/1211) [`98e212b`](https://github.com/browserbase/stagehand/commit/98e212b27887241879608c6c1b6c2524477a40d7) Thanks [@miguelg719](https://github.com/miguelg719)! - Add an example for passing custom tools to agent

- [#1206](https://github.com/browserbase/stagehand/pull/1206) [`d5ecbfc`](https://github.com/browserbase/stagehand/commit/d5ecbfc8e419a59b91c2115fd7f984378381d3d0) Thanks [@miguelg719](https://github.com/miguelg719)! - Export example AISdkClient properly from the stagehand package

## 3.0.0

### Major Changes

- Removes internal Playwright dependency
- A generous 20-40% speed increase across `act`, `extract`, & `observe` calls
- Compatibility with Playwright, Puppeteer, and Patchright
- Automatic action caching (agent, stagehand.act). Go from CUA → deterministic scripts w/o inference
- A suite of non AI primitives:
  - `page`
  - `locator` (built in closed mode shadow root traversal, with xpaths & css selectors)
  - `frameLocator`
  - `deepLocator` (crosses iframes & shadow roots)
- bun compatibility
- Simplified extract schemas
- CSS selector support (id-based support coming soon)
- Targeted extract and observe across iframes & shadow roots
- More intuitive type names (observeResult is now action, act accepts an instruction string instead of an action string, solidified ModelConfiguration)

Check the [migration guide](https://docs.stagehand.dev/v3/migrations/v2) for more information

## 2.5.0

### Minor Changes

- [#981](https://github.com/browserbase/stagehand/pull/981) [`8244ab2`](https://github.com/browserbase/stagehand/commit/8244ab247cd679962685ae2f7c54e874ce1fa614) Thanks [@sameelarif](https://github.com/sameelarif)! - Added support for `stagehand.agent` to interact with MCP servers as well as custom tools to be passed in. For more information, reference the [MCP integrations documentation](https://docs.stagehand.dev/best-practices/mcp-integrations)

### Patch Changes

- [#959](https://github.com/browserbase/stagehand/pull/959) [`09b5e1e`](https://github.com/browserbase/stagehand/commit/09b5e1e9c23c845903686db6665cc968ac34efbb) Thanks [@filip-michalsky](https://github.com/filip-michalsky)! - add webvoyager evals

- [#1049](https://github.com/browserbase/stagehand/pull/1049) [`e3734b9`](https://github.com/browserbase/stagehand/commit/e3734b9c98352d5f0a4eca49791b0bbf2130ab41) Thanks [@miguelg719](https://github.com/miguelg719)! - Support local MCP server connections

- [#1025](https://github.com/browserbase/stagehand/pull/1025) [`be85b19`](https://github.com/browserbase/stagehand/commit/be85b19679a826f19702e00f0aae72fce1118ec8) Thanks [@tkattkat](https://github.com/tkattkat)! - add support for custom baseUrl within openai provider

- [#1040](https://github.com/browserbase/stagehand/pull/1040) [`88d1565`](https://github.com/browserbase/stagehand/commit/88d1565c65bb65a104fea2d5f5e862bbbda69677) Thanks [@miguelg719](https://github.com/miguelg719)! - Allow OpenAI CUA to take in an optional baseURL

- [#1046](https://github.com/browserbase/stagehand/pull/1046) [`ab5d6ed`](https://github.com/browserbase/stagehand/commit/ab5d6ede19aabc059badc4247f1cb2c6c9e71bae) Thanks [@tkattkat](https://github.com/tkattkat)! - Add support for gpt-5 in operator agent

## 2.4.4

### Patch Changes

- [#1012](https://github.com/browserbase/stagehand/pull/1012) [`9e8c173`](https://github.com/browserbase/stagehand/commit/9e8c17374fdc8fbe7f26e6cf802c36bd14f11039) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix disabling api validation whenever a customLLM client is provided

## 2.4.3

### Patch Changes

- [#951](https://github.com/browserbase/stagehand/pull/951) [`f45afdc`](https://github.com/browserbase/stagehand/commit/f45afdccc8680650755fee66ffbeac32b41e075d) Thanks [@miguelg719](https://github.com/miguelg719)! - Patch GPT-5 new api format

- [#954](https://github.com/browserbase/stagehand/pull/954) [`261bba4`](https://github.com/browserbase/stagehand/commit/261bba43fa79ac3af95328e673ef3e9fced3279b) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add support for shadow DOMs (open & closed mode) when experimental: true

- [#944](https://github.com/browserbase/stagehand/pull/944) [`8de7bd8`](https://github.com/browserbase/stagehand/commit/8de7bd8635c2051cd8025e365c6c8aa83d81c7e7) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - Bump zod version compatibility and add pathing spec

- [#919](https://github.com/browserbase/stagehand/pull/919) [`3d80421`](https://github.com/browserbase/stagehand/commit/3d804210a106a6828c7fa50f8b765b10afd4cc6a) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - enable scrolling inside of iframes

- [#963](https://github.com/browserbase/stagehand/pull/963) [`0ead63d`](https://github.com/browserbase/stagehand/commit/0ead63d6526f6c286362b74b6407c8bebc900e69) Thanks [@tkattkat](https://github.com/tkattkat)! - Properly handle images in evaluator + clean up response parsing logic

- [#961](https://github.com/browserbase/stagehand/pull/961) [`8422828`](https://github.com/browserbase/stagehand/commit/8422828c4cd5fd5ebcf348cfbdb40c768bb76dd9) Thanks [@tkattkat](https://github.com/tkattkat)! - Add more evals for stagehand agent

- [#946](https://github.com/browserbase/stagehand/pull/946) [`b769206`](https://github.com/browserbase/stagehand/commit/b7692060f98a2f49aeeefb90d8789ed034b08ec2) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: unable to act on/get content from some same process iframes

- [#962](https://github.com/browserbase/stagehand/pull/962) [`72d2683`](https://github.com/browserbase/stagehand/commit/72d2683202af7e578d98367893964b33e0828de5) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - handle namespaced elements in xpath build step

## 2.4.2

### Patch Changes

- [#865](https://github.com/browserbase/stagehand/pull/865) [`6b4e6e3`](https://github.com/browserbase/stagehand/commit/6b4e6e3f31d5496cf15728e9018eddeb04839542) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - improve type safety for trimTrailingTextNode

- [#897](https://github.com/browserbase/stagehand/pull/897) [`e77d018`](https://github.com/browserbase/stagehand/commit/e77d0188683ebf596dfb78dfafbbca1dc32993f0) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix selfHeal to remember intially received arguments

- [#920](https://github.com/browserbase/stagehand/pull/920) [`c20adb9`](https://github.com/browserbase/stagehand/commit/c20adb95539fed8c56a4aa413262a9c65a8e6474) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: tab handling on API

- [#882](https://github.com/browserbase/stagehand/pull/882) [`b86df93`](https://github.com/browserbase/stagehand/commit/b86df93b9136aae96292121a29c25f3d74d84bf7) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - remove elements that don't have xpaths from observe response

- [#905](https://github.com/browserbase/stagehand/pull/905) [`023c2c2`](https://github.com/browserbase/stagehand/commit/023c2c273b46d3792d7e5d3c902089487b16b531) Thanks [@tkattkat](https://github.com/tkattkat)! - Delete old images from anthropic cua client

- [#925](https://github.com/browserbase/stagehand/pull/925) [`8c28647`](https://github.com/browserbase/stagehand/commit/8c2864755ecd05c8f7de235d4198deec0dd5f78e) Thanks [@miguelg719](https://github.com/miguelg719)! - Remove \_refreshPageFromApi()

- [#887](https://github.com/browserbase/stagehand/pull/887) [`87e09c6`](https://github.com/browserbase/stagehand/commit/87e09c618940f364ec8af00455a19a17ec63cbd3) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: allow xpaths with prepended 'xpath=' for targeted extract

- [#864](https://github.com/browserbase/stagehand/pull/864) [`a611115`](https://github.com/browserbase/stagehand/commit/a61111525d70b450bdfc43f112380f44899c9e97) Thanks [@miguelg719](https://github.com/miguelg719)! - Temporarily patch custom clients serialization error on api

- [#881](https://github.com/browserbase/stagehand/pull/881) [`69913fe`](https://github.com/browserbase/stagehand/commit/69913fe1dfb8201ae2aeffa5f049fb46ab02cbc2) Thanks [@miguelg719](https://github.com/miguelg719)! - Pass sdk version number to API for debugging

- [#913](https://github.com/browserbase/stagehand/pull/913) [`b1b83a1`](https://github.com/browserbase/stagehand/commit/b1b83a1d334fe76e5f5f9dd32dc92c16b7d40ce6) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - move iframe out of 'experimental'

- [#891](https://github.com/browserbase/stagehand/pull/891) [`be8497c`](https://github.com/browserbase/stagehand/commit/be8497cb6b142cc893cea9692b8c47bd19514c60) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: nested iframe xpath bug

- [#883](https://github.com/browserbase/stagehand/pull/883) [`98704c9`](https://github.com/browserbase/stagehand/commit/98704c9ed225ca25bbde4bb3dc286936e9c54471) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add timeout for JS click

- [#907](https://github.com/browserbase/stagehand/pull/907) [`04978bd`](https://github.com/browserbase/stagehand/commit/04978bdd30d2edcbc69eb9fd91358a16975ea2eb) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - store mapping of CDP frame ID -> page

## 2.4.1

### Patch Changes

- [#856](https://github.com/browserbase/stagehand/pull/856) [`8a43c5a`](https://github.com/browserbase/stagehand/commit/8a43c5a86d4da40cfaedd9cf2e42186928bdf946) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - set download behaviour by default

- [#857](https://github.com/browserbase/stagehand/pull/857) [`890ffcc`](https://github.com/browserbase/stagehand/commit/890ffccac5e0a60ade64a46eb550c981ffb3e84a) Thanks [@miguelg719](https://github.com/miguelg719)! - return "not-supported" for elements inside the shadow-dom

- [#844](https://github.com/browserbase/stagehand/pull/844) [`64c1072`](https://github.com/browserbase/stagehand/commit/64c10727bda50470483a3eb175c02842db0923a1) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - don't automatically close tabs

- [#860](https://github.com/browserbase/stagehand/pull/860) [`b077d3f`](https://github.com/browserbase/stagehand/commit/b077d3f48a97f47a71ccc79ae39b41e7f07f9c04) Thanks [@miguelg719](https://github.com/miguelg719)! - Set default schema on extract options with no schema

- [#842](https://github.com/browserbase/stagehand/pull/842) [`8bcb5d7`](https://github.com/browserbase/stagehand/commit/8bcb5d77debf6bf7601fd5c090efd7fde75c5d5e) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - improved handling for OS level dropdowns

- [#846](https://github.com/browserbase/stagehand/pull/846) [`7bf10c5`](https://github.com/browserbase/stagehand/commit/7bf10c55b267078fe847c1d7f7a60d604f9c7c94) Thanks [@miguelg719](https://github.com/miguelg719)! - Filter attaching to target worker / shared_worker

## 2.4.0

### Minor Changes

- [#819](https://github.com/browserbase/stagehand/pull/819) [`6a18c1e`](https://github.com/browserbase/stagehand/commit/6a18c1ee1e46d55c6e90c4d5572e17ed8daa140c) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - try playwright click and fall back to JS click event

### Patch Changes

- [#826](https://github.com/browserbase/stagehand/pull/826) [`124e0d3`](https://github.com/browserbase/stagehand/commit/124e0d3bb54ddb6738ede6d7aa99a945ef1cacd1) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix issue where we are unable to take actions on text nodes

- [#818](https://github.com/browserbase/stagehand/pull/818) [`1660751`](https://github.com/browserbase/stagehand/commit/1660751cd14cb5b27d44f8167216afb8d1c3c45c) Thanks [@miguelg719](https://github.com/miguelg719)! - Added CUA support for Claude 4 models

- [#821](https://github.com/browserbase/stagehand/pull/821) [`cadac9d`](https://github.com/browserbase/stagehand/commit/cadac9da09123d12e5d496a0e8b12660964c1b33) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - use playwright instead of playwright test

- [#832](https://github.com/browserbase/stagehand/pull/832) [`759da55`](https://github.com/browserbase/stagehand/commit/759da55775eb2df81d56ae18c0f386fd9b02a9f0) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix \_refreshPageFromAPI to use parametrized apiKey

- [#810](https://github.com/browserbase/stagehand/pull/810) [`a175a51`](https://github.com/browserbase/stagehand/commit/a175a519b8c14300db6f1ed30709e113d18e99db) Thanks [@miguelg719](https://github.com/miguelg719)! - Update logos

- [#822](https://github.com/browserbase/stagehand/pull/822) [`8527a80`](https://github.com/browserbase/stagehand/commit/8527a80522c3eedb9516a6caa1a0e4e4be981a3d) Thanks [@miguelg719](https://github.com/miguelg719)! - Add model with date tag for OpenAI CUA

- [#833](https://github.com/browserbase/stagehand/pull/833) [`55fca2f`](https://github.com/browserbase/stagehand/commit/55fca2f7da63cc0ef6e27b45a33f63c666cdce7e) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - adjust stagehandLogger.warn() level to be 1 instead of 0

## 2.3.1

### Patch Changes

- [#796](https://github.com/browserbase/stagehand/pull/796) [`12a99b3`](https://github.com/browserbase/stagehand/commit/12a99b398d8a4c3eea3ca69a3cf793faaaf4aea3) Thanks [@miguelg719](https://github.com/miguelg719)! - Added a experimental flag to enable the newest and most experimental features

- [#807](https://github.com/browserbase/stagehand/pull/807) [`2451797`](https://github.com/browserbase/stagehand/commit/2451797f64c0efa4a72fd70265110003c8d0a6cd) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - include version number in StagehandDefaultError message

- [#803](https://github.com/browserbase/stagehand/pull/803) [`1d631a5`](https://github.com/browserbase/stagehand/commit/1d631a57a197390f672b718ae5199991ab27cfb1) Thanks [@miguelg719](https://github.com/miguelg719)! - Enable session affinity for cache optimization

- [#804](https://github.com/browserbase/stagehand/pull/804) [`9c398bb`](https://github.com/browserbase/stagehand/commit/9c398bb9ec2d10bdb53ad5aa7e3b58cce24fdb2b) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - update operatorResponseSchema based on new openai spec

- [#786](https://github.com/browserbase/stagehand/pull/786) [`c19ad7f`](https://github.com/browserbase/stagehand/commit/c19ad7f1e082e91fdeaa9c2ef63767a5a2b3a195) Thanks [@miguelg719](https://github.com/miguelg719)! - Handle reroute to account for rollout

## 2.3.0

### Minor Changes

- [#737](https://github.com/browserbase/stagehand/pull/737) [`6ef6073`](https://github.com/browserbase/stagehand/commit/6ef60730cab0ad9025f44b6eeb2c83751d1dcd35) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - deprecate useTextExtract and remove functionality

### Patch Changes

- [#741](https://github.com/browserbase/stagehand/pull/741) [`5680d25`](https://github.com/browserbase/stagehand/commit/5680d2509352c383ad502c9f4fabde01fa638833) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - use safeparse for zod validation

- [#783](https://github.com/browserbase/stagehand/pull/783) [`4de92a8`](https://github.com/browserbase/stagehand/commit/4de92a8af461fc95063faf39feee1d49259f58ba) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix the readme logo link

## 2.2.1

### Patch Changes

- [#721](https://github.com/browserbase/stagehand/pull/721) [`be8652e`](https://github.com/browserbase/stagehand/commit/be8652e770b57fdb3299fa0b2efa4eb0e816434e) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix stagehand.close() functionality to include calling browser.close()

- [#724](https://github.com/browserbase/stagehand/pull/724) [`6b413b7`](https://github.com/browserbase/stagehand/commit/6b413b7ad00b13ca0bd53ee2e7393023821408b6) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - rm refine step in extract

- [#712](https://github.com/browserbase/stagehand/pull/712) [`7eafbd9`](https://github.com/browserbase/stagehand/commit/7eafbd9b1a73b37effa444929767df7c592caf02) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - deprecated `onlyVisible` param and remove its functionality

- [#725](https://github.com/browserbase/stagehand/pull/725) [`1b50aa6`](https://github.com/browserbase/stagehand/commit/1b50aa61cf0a429dd6cb2760a08f7f698a50454b) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - dont overwrite .describe() when user defines a zod schema with z.string().url().describe()

- [#717](https://github.com/browserbase/stagehand/pull/717) [`f2b7f1f`](https://github.com/browserbase/stagehand/commit/f2b7f1f284eef1f96753319b66c7d0b273a6f8cd) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - don't publish uncompiled ts to npm

- [#719](https://github.com/browserbase/stagehand/pull/719) [`c8d672f`](https://github.com/browserbase/stagehand/commit/c8d672f7c410c256defbc2e87ead99239837aa28) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix `Invalid schema for response_format` error when extracting links

- [#722](https://github.com/browserbase/stagehand/pull/722) [`bebf204`](https://github.com/browserbase/stagehand/commit/bebf2044502333c694743078c5b0c9deae11fb79) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - replace NBSP with regular space & remove special characters from dom+a11y tree

- [#714](https://github.com/browserbase/stagehand/pull/714) [`37d6810`](https://github.com/browserbase/stagehand/commit/37d6810a704773d0383a86f98f5f17c7d5b21975) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix the native AI SDK client implementation to optionally take in an API key

## 2.2.0

### Minor Changes

- [#655](https://github.com/browserbase/stagehand/pull/655) [`8814af9`](https://github.com/browserbase/stagehand/commit/8814af9ece99fddc3dd9fb32671d0513a3a00c67) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - extract links

- [#675](https://github.com/browserbase/stagehand/pull/675) [`35c55eb`](https://github.com/browserbase/stagehand/commit/35c55ebf6c2867801a0a6f6988a883c8cb90cf9a) Thanks [@tkattkat](https://github.com/tkattkat)! - Added Gemini 2.5 Flash to Google supported models

- [#668](https://github.com/browserbase/stagehand/pull/668) [`5c6d2cf`](https://github.com/browserbase/stagehand/commit/5c6d2cf89c9fbf198485506ed9ed75e07aec5cd4) Thanks [@miguelg719](https://github.com/miguelg719)! - Added a new class - Stagehand Evaluator - that wraps around a Stagehand object to determine whether a task is successful or not. Currently used for agent evals

### Patch Changes

- [#706](https://github.com/browserbase/stagehand/pull/706) [`18ac6fb`](https://github.com/browserbase/stagehand/commit/18ac6fba30f45b7557cecb890f4e84c75de8383c) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - remove unused fillInVariables fn

- [#692](https://github.com/browserbase/stagehand/pull/692) [`6b95248`](https://github.com/browserbase/stagehand/commit/6b95248d6e02e5304ce4dd60499e31fc42af57eb) Thanks [@miguelg719](https://github.com/miguelg719)! - Updated the list of OpenAI models (4.1, o3...)

- [#688](https://github.com/browserbase/stagehand/pull/688) [`7d81b3c`](https://github.com/browserbase/stagehand/commit/7d81b3c951c1f3dfc46845aefcc26ff175299bca) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - wrap page.evaluate to make sure we have injected browser side scripts before calling them

- [#664](https://github.com/browserbase/stagehand/pull/664) [`b5ca00a`](https://github.com/browserbase/stagehand/commit/b5ca00a25ad0c33a5f4d3198e1bc59edb9956e7c) Thanks [@miguelg719](https://github.com/miguelg719)! - remove unnecessary log

- [#683](https://github.com/browserbase/stagehand/pull/683) [`8f0f97b`](https://github.com/browserbase/stagehand/commit/8f0f97bc491e23ff0078c802aaf509fd04173c37) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - use javsacript click instead of playwright

- [#705](https://github.com/browserbase/stagehand/pull/705) [`346ef5d`](https://github.com/browserbase/stagehand/commit/346ef5d0132dc1418dac18d26640a8df0435af57) Thanks [@miguelg719](https://github.com/miguelg719)! - Fixed removing a hanging observation map that is no longer used

- [#698](https://github.com/browserbase/stagehand/pull/698) [`c145bc1`](https://github.com/browserbase/stagehand/commit/c145bc1d90ffd0d71c412de3af1c26c121e0b101) Thanks [@sameelarif](https://github.com/sameelarif)! - Fixing LLM client support to natively integrate with AI SDK

- [#687](https://github.com/browserbase/stagehand/pull/687) [`edd6d3f`](https://github.com/browserbase/stagehand/commit/edd6d3feb47aac9f312a5edad78bf850ae1541db) Thanks [@miguelg719](https://github.com/miguelg719)! - Fixed the schema input for Gemini's response model

- [#678](https://github.com/browserbase/stagehand/pull/678) [`5ec43d8`](https://github.com/browserbase/stagehand/commit/5ec43d8b9568c0f86b3e24bd83d1826c837656ed) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - allow form filling when form is not top-most element

- [#694](https://github.com/browserbase/stagehand/pull/694) [`b8cc164`](https://github.com/browserbase/stagehand/commit/b8cc16405b712064a54c8cd591750368a47f35ea) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add telemetry for cua agents to stagehand.metrics

- [#699](https://github.com/browserbase/stagehand/pull/699) [`d9f4243`](https://github.com/browserbase/stagehand/commit/d9f4243f6a8c8d4f3003ad6589f7eb4da6d23d0f) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - rm deprecated primitives from stagehand object

- [#710](https://github.com/browserbase/stagehand/pull/710) [`9f4ab76`](https://github.com/browserbase/stagehand/commit/9f4ab76a0c1f0c2171290765c48c3bcea5b50e0f) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - support targeted extract for domExtract

- [#677](https://github.com/browserbase/stagehand/pull/677) [`bc5a731`](https://github.com/browserbase/stagehand/commit/bc5a731241f7f4c5040dd672d8e3787555766421) Thanks [@miguelg719](https://github.com/miguelg719)! - Fixes a redundant unnecessary log

## 2.1.0

### Minor Changes

- [#659](https://github.com/browserbase/stagehand/pull/659) [`f9a435e`](https://github.com/browserbase/stagehand/commit/f9a435e938daccfb2e54ca23fad8ef75128a4486) Thanks [@miguelg719](https://github.com/miguelg719)! - Added native support for Google Generative models (Gemini)

### Patch Changes

- [#647](https://github.com/browserbase/stagehand/pull/647) [`ca5467d`](https://github.com/browserbase/stagehand/commit/ca5467de7d31bfb270b6b625224a926c52c97900) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - collapse redundant text nodes into parent elements

- [#636](https://github.com/browserbase/stagehand/pull/636) [`9037430`](https://github.com/browserbase/stagehand/commit/903743097367ba6bb12baa9f0fa8f7985f543fdc) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix token act metrics and inference logging being misplaced as observe metrics and inference logging

- [#648](https://github.com/browserbase/stagehand/pull/648) [`169e7ea`](https://github.com/browserbase/stagehand/commit/169e7ea9e229503ae5958eaa4511531578ee3841) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add mapping of node id -> url

- [#654](https://github.com/browserbase/stagehand/pull/654) [`57a9853`](https://github.com/browserbase/stagehand/commit/57a98538381e0e54fbb734b43c50d61fd0d567df) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix repeated up & down scrolling bug for clicks inside `act`

- [#624](https://github.com/browserbase/stagehand/pull/624) [`cf167a4`](https://github.com/browserbase/stagehand/commit/cf167a437865e8e8bdb8739d22c3b3bb84e185de) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - export stagehand error classes so they can be referenced from @dist

- [#640](https://github.com/browserbase/stagehand/pull/640) [`178f5f0`](https://github.com/browserbase/stagehand/commit/178f5f0a8fecd876adfb4e29983853bdf7ec72fd) Thanks [@yash1744](https://github.com/yash1744)! - Added support for stagehand agents to automatically redirect to https://google.com when the page URL is empty or set to about:blank, preventing empty screenshots and saving tokens.

- [#661](https://github.com/browserbase/stagehand/pull/661) [`bf823a3`](https://github.com/browserbase/stagehand/commit/bf823a36930b0686b416a42302ef8c021b4aba75) Thanks [@kamath](https://github.com/kamath)! - fix press enter

- [#633](https://github.com/browserbase/stagehand/pull/633) [`86724f6`](https://github.com/browserbase/stagehand/commit/86724f6fb0abc7292423ac5bd0bebcd352f95940) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix the getBrowser logic for redundant api calls and throw informed errors

- [#656](https://github.com/browserbase/stagehand/pull/656) [`c630373`](https://github.com/browserbase/stagehand/commit/c630373dede4c775875834bfb860436ba2ea48d2) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - parse out % signs from variables in act

- [#637](https://github.com/browserbase/stagehand/pull/637) [`944bbbf`](https://github.com/browserbase/stagehand/commit/944bbbfe8bfb357b4910584447a93f6f402c3826) Thanks [@kamath](https://github.com/kamath)! - Fix: forward along the stack trace in StagehandDefaultError

## 2.0.0

### Major Changes

- [#591](https://github.com/browserbase/stagehand/pull/591) [`e234a0f`](https://github.com/browserbase/stagehand/commit/e234a0f80bf4c07bcc57265da216cbc4ab3bd19d) Thanks [@miguelg719](https://github.com/miguelg719)! - Announcing **Stagehand 2.0**! 🎉

  We're thrilled to announce the release of Stagehand 2.0, bringing significant improvements to make browser automation more powerful, faster, and easier to use than ever before.

  ### 🚀 New Features
  - **Introducing `stagehand.agent`**: A powerful new way to integrate SOTA Computer use models or Browserbase's [Open Operator](https://operator.browserbase.com) into Stagehand with one line of code! Perfect for multi-step workflows and complex interactions. [Learn more](https://docs.stagehand.dev/concepts/agent)
  - **Lightning-fast `act` and `extract`**: Major performance improvements to make your automations run significantly faster.
  - **Enhanced Logging**: Better visibility into what's happening during automation with improved logging and debugging capabilities.
  - **Comprehensive Documentation**: A completely revamped documentation site with better examples, guides, and best practices.
  - **Improved Error Handling**: More descriptive errors and better error recovery to help you debug issues faster.

  ### 🛠️ Developer Experience
  - **Better TypeScript Support**: Enhanced type definitions and better IDE integration
  - **Better Error Messages**: Clearer, more actionable error messages to help you debug faster
  - **Improved Caching**: More reliable action caching for better performance

  We're excited to see what you build with Stagehand 2.0! For questions or support, join our [Slack community](https://stagehand.dev/slack).

  For more details, check out our [documentation](https://docs.stagehand.dev).

### Minor Changes

- [#588](https://github.com/browserbase/stagehand/pull/588) [`ba9efc5`](https://github.com/browserbase/stagehand/commit/ba9efc5580a536bc3c158e507a6c6695825c2834) Thanks [@sameelarif](https://github.com/sameelarif)! - Added support for offloading agent tasks to the API.

- [#600](https://github.com/browserbase/stagehand/pull/600) [`11e015d`](https://github.com/browserbase/stagehand/commit/11e015daac56dc961b8c8d54ce360fd00d4fee38) Thanks [@sameelarif](https://github.com/sameelarif)! - Added a `stagehand.history` array which stores an array of `act`, `extract`, `observe`, and `goto` calls made. Since this history array is stored on the `StagehandPage` level, it will capture methods even if indirectly called by an agent.

- [#601](https://github.com/browserbase/stagehand/pull/601) [`1d22604`](https://github.com/browserbase/stagehand/commit/1d2260401e27bae25779a55bb2ed7b7153c34fd0) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add custom error classes

- [#599](https://github.com/browserbase/stagehand/pull/599) [`75d8fb3`](https://github.com/browserbase/stagehand/commit/75d8fb36a67cd84eb55b509bf959edc7b05059da) Thanks [@miguelg719](https://github.com/miguelg719)! - cleaner logging with pino

- [#609](https://github.com/browserbase/stagehand/pull/609) [`c92295d`](https://github.com/browserbase/stagehand/commit/c92295d8424dac1a4f81066ca260ade2d5fce80b) Thanks [@kamath](https://github.com/kamath)! - Removed deprecated fields and methods from Stagehand constructor and added cdpUrl to localBrowserLaunchOptions for custom CDP URLs support.

- [#571](https://github.com/browserbase/stagehand/pull/571) [`73d6736`](https://github.com/browserbase/stagehand/commit/73d67368b88002c17814e46e75a99456bf355c4e) Thanks [@miguelg719](https://github.com/miguelg719)! - You can now use Computer Using Agents (CUA) natively in Stagehand for both Anthropic and OpenAI models! This unlocks a brand new frontier of applications for Stagehand users 🤘

- [#619](https://github.com/browserbase/stagehand/pull/619) [`7b0b996`](https://github.com/browserbase/stagehand/commit/7b0b9969a58014ae3e99b2054e4463b785073cfd) Thanks [@sameelarif](https://github.com/sameelarif)! - add disablePino flag to stagehand constructor params

- [#620](https://github.com/browserbase/stagehand/pull/620) [`566e587`](https://github.com/browserbase/stagehand/commit/566e5877a1861e0eae5a118d34efe09d43a37098) Thanks [@kamath](https://github.com/kamath)! - You can now pass in an OpenAI instance as an `llmClient` to the Stagehand constructor! This allows you to use Stagehand with any OpenAI-compatible model, like Ollama, Gemini, etc., as well as OpenAI wrappers like Braintrust.

- [#586](https://github.com/browserbase/stagehand/pull/586) [`c57dc19`](https://github.com/browserbase/stagehand/commit/c57dc19c448b8c2aab82953291f4e38f202c4729) Thanks [@sameelarif](https://github.com/sameelarif)! - Added native Stagehand agentic loop functionality. This allows you to build agentic workflows with a single prompt without using a computer-use model. To try it out, create a `stagehand.agent` without passing in a provider.

### Patch Changes

- [#580](https://github.com/browserbase/stagehand/pull/580) [`179e17c`](https://github.com/browserbase/stagehand/commit/179e17c2d1c9837de49c776d9850a330a759e73f) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - refactor \_performPlaywrightMethod

- [#608](https://github.com/browserbase/stagehand/pull/608) [`71ee10d`](https://github.com/browserbase/stagehand/commit/71ee10d50cb46e83d43fd783e1404569e6f317cf) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - added support for "scrolling to next/previous chunk"

- [#594](https://github.com/browserbase/stagehand/pull/594) [`e483484`](https://github.com/browserbase/stagehand/commit/e48348412a6e651967ba22d097d5308af0e8d0a8) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - pass observeHandler into actHandler

- [#569](https://github.com/browserbase/stagehand/pull/569) [`17e8b40`](https://github.com/browserbase/stagehand/commit/17e8b40f94b30f6e253443a4bbb8a3e364e58e38) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - you can now call stagehand.metrics to get token usage metrics. you can also set logInferenceToFile in stagehand config to log the entire call/response history from stagehand & the LLM.

- [#617](https://github.com/browserbase/stagehand/pull/617) [`affa564`](https://github.com/browserbase/stagehand/commit/affa5646658399ab71ed08c1b9ce0fd776b46fca) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - use a11y tree for default extract

- [#589](https://github.com/browserbase/stagehand/pull/589) [`0c4b1e7`](https://github.com/browserbase/stagehand/commit/0c4b1e7e6ff4b8a60af4a2d0d2056bff847227d5) Thanks [@miguelg719](https://github.com/miguelg719)! - Added CDP support for screenshots, find more about the benefits here: https://docs.browserbase.com/features/screenshots#why-use-cdp-for-screenshots%3F

- [#584](https://github.com/browserbase/stagehand/pull/584) [`c7c1a80`](https://github.com/browserbase/stagehand/commit/c7c1a8066be33188ba1e900828045db61410025c) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix to remove unnecessary healtcheck ping on sdk

- [#616](https://github.com/browserbase/stagehand/pull/616) [`2a27e1c`](https://github.com/browserbase/stagehand/commit/2a27e1c8e967befbbbb05ea71369878ac1573658) Thanks [@miguelg719](https://github.com/miguelg719)! - Fixed new opened tab handling for CUA models

- [#582](https://github.com/browserbase/stagehand/pull/582) [`dfd24e6`](https://github.com/browserbase/stagehand/commit/dfd24e638ef3723d3a8a3a33ff7942af0ac4745f) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - support api usage for extract with no args

- [#563](https://github.com/browserbase/stagehand/pull/563) [`98166d7`](https://github.com/browserbase/stagehand/commit/98166d76d30bc67d6b04b3d5c39f78f92c254b49) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - support scrolling in `act`

- [#598](https://github.com/browserbase/stagehand/pull/598) [`53889d4`](https://github.com/browserbase/stagehand/commit/53889d4b6e772098beaba2e1ee5a24e6f07706bb) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix the open operator handler to work with anthropic

- [#605](https://github.com/browserbase/stagehand/pull/605) [`b8beaec`](https://github.com/browserbase/stagehand/commit/b8beaec451a03eaa5d12281fe7c8d4eb9c9d7e81) Thanks [@sameelarif](https://github.com/sameelarif)! - Added support for resuming a Stagehand session created on the API.

- [#612](https://github.com/browserbase/stagehand/pull/612) [`cd36068`](https://github.com/browserbase/stagehand/commit/cd3606854c465747c78b44763469dfdfa16db1b0) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - remove all logic related to dom based act

- [#577](https://github.com/browserbase/stagehand/pull/577) [`4fdbf63`](https://github.com/browserbase/stagehand/commit/4fdbf6324a0dc68568bba73ea4d9018b2ed67849) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - remove debugDom

- [#603](https://github.com/browserbase/stagehand/pull/603) [`2a14a60`](https://github.com/browserbase/stagehand/commit/2a14a607f3e7fa3ca9a02670afdc7e60ccfbfb3f) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - rm unused handlePossiblePageNavigation

- [#614](https://github.com/browserbase/stagehand/pull/614) [`a59eaef`](https://github.com/browserbase/stagehand/commit/a59eaef67c2f4a0cb07bb0046fe7e93e2ba4dc41) Thanks [@kamath](https://github.com/kamath)! - override whatwg-url to avoid punycode warning

- [#573](https://github.com/browserbase/stagehand/pull/573) [`c24f3c9`](https://github.com/browserbase/stagehand/commit/c24f3c9a58873c3920fab0f9891c2bf5245c9b5e) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - return act result in actFromObserve

## 1.14.0

### Minor Changes

- [#518](https://github.com/browserbase/stagehand/pull/518) [`516725f`](https://github.com/browserbase/stagehand/commit/516725fc1c5d12d22caac0078a118c77bfe033a8) Thanks [@sameelarif](https://github.com/sameelarif)! - `act()` can now use `observe()` under the hood, resulting in significant performance improvements. To opt-in to this change, set `slowDomBasedAct: false` in `ActOptions`.

- [#483](https://github.com/browserbase/stagehand/pull/483) [`8c9445f`](https://github.com/browserbase/stagehand/commit/8c9445fde9724ae33eeeb1234fd5b9bbd418bfdb) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - When using `textExtract`, you can now do targetted extraction by passing an xpath string into extract via the `selector` parameter. This limits the dom processing step to a target element, reducing tokens and increasing speed. For example:

  ```typescript
  const weatherData = await stagehand.page.extract({
    instruction: "extract the weather data for Sun, Feb 23 at 11PM",
    schema: z.object({
      temperature: z.string(),
      weather_description: z.string(),
      wind: z.string(),
      humidity: z.string(),
      barometer: z.string(),
      visibility: z.string(),
    }),
    modelName,
    useTextExtract,
    selector: xpath, // xpath of the element to extract from
  });
  ```

- [#556](https://github.com/browserbase/stagehand/pull/556) [`499a72d`](https://github.com/browserbase/stagehand/commit/499a72dc56009791ce065270b854b12fc5570050) Thanks [@kamath](https://github.com/kamath)! - You can now set a timeout for dom-based stagehand act! Do this in `act` with `timeoutMs` as a parameter, or set a global param to `actTimeoutMs` in Stagehand config.

- [#544](https://github.com/browserbase/stagehand/pull/544) [`55c9673`](https://github.com/browserbase/stagehand/commit/55c9673c5948743b804d70646f425a61818c7789) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - you can now deterministically get the full text representation of a webpage by calling `extract()` (with no arguments)

- [#538](https://github.com/browserbase/stagehand/pull/538) [`d898d5b`](https://github.com/browserbase/stagehand/commit/d898d5b9e1c3b80e62e72d36d1754b3e50d5a2b4) Thanks [@sameelarif](https://github.com/sameelarif)! - Added `gpt-4.5-preview` and `claude-3-7-sonnet-latest` as supported models.

- [#523](https://github.com/browserbase/stagehand/pull/523) [`44cf7cc`](https://github.com/browserbase/stagehand/commit/44cf7cc9ac1209c97d9153281970899b10a2ddc9) Thanks [@kwt00](https://github.com/kwt00)! You can now natively run Cerebras LLMs! `cerebras-llama-3.3-70b` and `cerebras-llama-3.1-8b` are now supported models as long as `CEREBRAS_API_KEY` is set in your environment.

- [#542](https://github.com/browserbase/stagehand/pull/542) [`cf7fe66`](https://github.com/browserbase/stagehand/commit/cf7fe665e6d1eeda97582ee2816f1dc3a66c6152) Thanks [@sankalpgunturi](https://github.com/sankalpgunturi)! You can now natively run Groq LLMs! `groq-llama-3.3-70b-versatile` and `groq-llama-3.3-70b-specdec` are now supported models as long as `GROQ_API_KEY` is set in your environment.

### Patch Changes

- [#506](https://github.com/browserbase/stagehand/pull/506) [`e521645`](https://github.com/browserbase/stagehand/commit/e5216455ce3fc2a4f4f7aa5614ecc92354eb670c) Thanks [@miguelg719](https://github.com/miguelg719)! - fixing 5s timeout on actHandler

- [#535](https://github.com/browserbase/stagehand/pull/535) [`3782054`](https://github.com/browserbase/stagehand/commit/3782054734dcd0346f84003ddd8e0e484b379459) Thanks [@miguelg719](https://github.com/miguelg719)! - Adding backwards compatibility to new act->observe pipeline by accepting actOptions

- [#508](https://github.com/browserbase/stagehand/pull/508) [`270f666`](https://github.com/browserbase/stagehand/commit/270f6669f1638f52fd5cd3f133f76446ced6ef9f) Thanks [@miguelg719](https://github.com/miguelg719)! - Fixed stagehand to support multiple pages with an enhanced context

- [#559](https://github.com/browserbase/stagehand/pull/559) [`18533ad`](https://github.com/browserbase/stagehand/commit/18533ad824722e4e699323248297e184bae9254e) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: continuously adjusting chunk size inside `act`

- [#554](https://github.com/browserbase/stagehand/pull/554) [`5f1868b`](https://github.com/browserbase/stagehand/commit/5f1868bd95478b3eb517319ebca7b0af4e91d144) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix targetted extract issue with scrollintoview and not chunking correctly

- [#555](https://github.com/browserbase/stagehand/pull/555) [`fc5e8b6`](https://github.com/browserbase/stagehand/commit/fc5e8b6c5a606da96e6ed572dc8ffc6caef57576) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix issue where processAllOfDom doesnt scroll to end of page when there is dynamic content

- [#552](https://github.com/browserbase/stagehand/pull/552) [`a25a4cb`](https://github.com/browserbase/stagehand/commit/a25a4cb538d64f50b5bd834dd88e8e6086a73078) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - accept xpaths with 'xpath=' prepended to the front in addition to xpaths without

- [#534](https://github.com/browserbase/stagehand/pull/534) [`f0c162a`](https://github.com/browserbase/stagehand/commit/f0c162a6b4d1ac72c42f26462d7241a08b5c4e0a) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - call this.end() if the process exists

- [#528](https://github.com/browserbase/stagehand/pull/528) [`c820bfc`](https://github.com/browserbase/stagehand/commit/c820bfcfc9571fea90afd1595775c5946118cfaf) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - handle attempt to close session that has already been closed when using the api

- [#520](https://github.com/browserbase/stagehand/pull/520) [`f49eebd`](https://github.com/browserbase/stagehand/commit/f49eebd98c1d61413a3ea4c798595db601d55da8) Thanks [@miguelg719](https://github.com/miguelg719)! - Performing act from a 'not-supported' ObserveResult will now throw an informed error

## 1.13.1

### Patch Changes

- [#509](https://github.com/browserbase/stagehand/pull/509) [`a7d345e`](https://github.com/browserbase/stagehand/commit/a7d345e75434aebb656e1aa5aa61caed00dc99a8) Thanks [@miguelg719](https://github.com/miguelg719)! - Bun runs will now throw a more informed error

## 1.13.0

### Minor Changes

- [#486](https://github.com/browserbase/stagehand/pull/486) [`33f2b3f`](https://github.com/browserbase/stagehand/commit/33f2b3f8deff86ac2073b6d35b7413b0aeaba2f9) Thanks [@sameelarif](https://github.com/sameelarif)! - [Unreleased] Parameterized offloading Stagehand method calls to the Stagehand API. In the future, this will allow for better observability and debugging experience.

- [#494](https://github.com/browserbase/stagehand/pull/494) [`9ba4b0b`](https://github.com/browserbase/stagehand/commit/9ba4b0b563cbc77d40cac31c11e17e365a9d1749) Thanks [@pkiv](https://github.com/pkiv)! - Added LocalBrowserLaunchOptions to provide comprehensive configuration options for local browser instances. Deprecated the top-level headless option in favor of using localBrowserLaunchOptions.headless

- [#500](https://github.com/browserbase/stagehand/pull/500) [`a683fab`](https://github.com/browserbase/stagehand/commit/a683fab9ca90c45d78f6602a228c2d3219b776dc) Thanks [@miguelg719](https://github.com/miguelg719)! - Including Iframes in ObserveResults. This appends any iframe(s) found in the page to the end of observe results on any observe call.

- [#504](https://github.com/browserbase/stagehand/pull/504) [`577662e`](https://github.com/browserbase/stagehand/commit/577662e985a6a6b0477815853d98610f3a6b567d) Thanks [@sameelarif](https://github.com/sameelarif)! - Enabled support for Browserbase captcha solving after page navigations. This can be enabled with the new constructor parameter: `waitForCaptchaSolves`.

- [#496](https://github.com/browserbase/stagehand/pull/496) [`28ca9fb`](https://github.com/browserbase/stagehand/commit/28ca9fbc6f3cdc88437001108a9a6c4388ba0303) Thanks [@sameelarif](https://github.com/sameelarif)! - Fixed browserbaseSessionCreateParams not being passed in to the API initialization payload.

### Patch Changes

- [#459](https://github.com/browserbase/stagehand/pull/459) [`62a29ee`](https://github.com/browserbase/stagehand/commit/62a29eea982bbb855e2f885c09ac4c1334f3e0dc) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - create a11y + dom hybrid input for observe

- [#463](https://github.com/browserbase/stagehand/pull/463) [`e40bf6f`](https://github.com/browserbase/stagehand/commit/e40bf6f517331fc9952c3c9f2683b7e02ffb9735) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - include 'Scrollable' annotations in a11y-dom hybrid

- [#480](https://github.com/browserbase/stagehand/pull/480) [`4c07c44`](https://github.com/browserbase/stagehand/commit/4c07c444f0e71faf54413b2eeab760c7916a36e3) Thanks [@miguelg719](https://github.com/miguelg719)! - Adding a fallback try on actFromObserveResult to use the description from observe and call regular act.

- [#487](https://github.com/browserbase/stagehand/pull/487) [`2c855cf`](https://github.com/browserbase/stagehand/commit/2c855cffdfa2b0af9924612b9c59df7b65df6443) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - update refine extraction prompt to ensure correct schema is used

- [#497](https://github.com/browserbase/stagehand/pull/497) [`945ed04`](https://github.com/browserbase/stagehand/commit/945ed0426d34d2cb833aec8ba67bd4cba6c3b660) Thanks [@kamath](https://github.com/kamath)! - add gpt 4o november snapshot

## 1.12.0

### Minor Changes

- [#426](https://github.com/browserbase/stagehand/pull/426) [`bbbcee7`](https://github.com/browserbase/stagehand/commit/bbbcee7e7d86f5bf90cbb93f2ac9ad5935f15896) Thanks [@miguelg719](https://github.com/miguelg719)! - Observe got a major upgrade. Now it will return a suggested playwright method with any necessary arguments for the generated candidate elements. It also includes a major speedup when using a11y tree processing for context.

- [#452](https://github.com/browserbase/stagehand/pull/452) [`16837ec`](https://github.com/browserbase/stagehand/commit/16837ece839e192fbf7b68bec128dd02f22c2613) Thanks [@kamath](https://github.com/kamath)! - add o3-mini to availablemodel

- [#441](https://github.com/browserbase/stagehand/pull/441) [`1032d7d`](https://github.com/browserbase/stagehand/commit/1032d7d7d9c1ef8f30183c9019ea8324f1bdd5c6) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - allow act to accept observe output

### Patch Changes

- [#458](https://github.com/browserbase/stagehand/pull/458) [`da2e5d1`](https://github.com/browserbase/stagehand/commit/da2e5d1314b7504877fd50090e6a4b47f44fb9f6) Thanks [@miguelg719](https://github.com/miguelg719)! - Updated getAccessibilityTree() to make sure it doesn't skip useful nodes. Improved getXPathByResolvedObjectId() to account for text nodes and not skip generation

- [#448](https://github.com/browserbase/stagehand/pull/448) [`b216072`](https://github.com/browserbase/stagehand/commit/b2160723923ed78eba83e75c7270634ca7d217de) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - improve handling of radio button clicks

- [#445](https://github.com/browserbase/stagehand/pull/445) [`5bc514f`](https://github.com/browserbase/stagehand/commit/5bc514fc18e6634b1c81553bbc1e8b7d71b67d34) Thanks [@miguelg719](https://github.com/miguelg719)! - Adding back useAccessibilityTree param to observe with a deprecation warning/error indicating to use onlyVisible instead

## 1.11.0

### Minor Changes

- [#428](https://github.com/browserbase/stagehand/pull/428) [`5efeb5a`](https://github.com/browserbase/stagehand/commit/5efeb5ad44852efe7b260862729a5ac74eaa0228) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - temporarily remove vision

## 1.10.1

### Patch Changes

- [#422](https://github.com/browserbase/stagehand/pull/422) [`a2878d0`](https://github.com/browserbase/stagehand/commit/a2878d0acaf393b37763fb0c07b1a24043f7eb8d) Thanks [@miguelg719](https://github.com/miguelg719)! - Fixing a build type error for async functions being called inside evaulate for observeHandler.

## 1.10.0

### Minor Changes

- [#412](https://github.com/browserbase/stagehand/pull/412) [`4aa4813`](https://github.com/browserbase/stagehand/commit/4aa4813ad62cefc333a04ea6b1004f5888dec70f) Thanks [@miguelg719](https://github.com/miguelg719)! - Includes a new format to get website context using accessibility (a11y) trees. The new context is provided optionally with the flag useAccessibilityTree for observe tasks.

- [#417](https://github.com/browserbase/stagehand/pull/417) [`1f2b2c5`](https://github.com/browserbase/stagehand/commit/1f2b2c57d93e3b276c61224e1e26c65c2cb50e12) Thanks [@sameelarif](https://github.com/sameelarif)! - Simplify Stagehand method calls by allowing a simple string input instead of an options object.

- [#405](https://github.com/browserbase/stagehand/pull/405) [`0df1e23`](https://github.com/browserbase/stagehand/commit/0df1e233d4ad4ba39da457b6ed85916d8d20e12e) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - in ProcessAllOfDom, scroll on large scrollable elements instead of just the root DOM

- [#373](https://github.com/browserbase/stagehand/pull/373) [`ff00965`](https://github.com/browserbase/stagehand/commit/ff00965160d568ae0bc3ca437c01f95b5c6e9039) Thanks [@sameelarif](https://github.com/sameelarif)! - Allow the input of custom instructions into the constructor so that users can guide, or provide guardrails to, the LLM in making decisions.

### Patch Changes

- [#386](https://github.com/browserbase/stagehand/pull/386) [`2cee0a4`](https://github.com/browserbase/stagehand/commit/2cee0a45ae2b48d1de6543b196e338e7021e59fe) Thanks [@kamath](https://github.com/kamath)! - add demo gif

- [#362](https://github.com/browserbase/stagehand/pull/362) [`9c20de3`](https://github.com/browserbase/stagehand/commit/9c20de3e66f0ac20374d5e5e02eb107c620a2263) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - reduce collisions and improve accuracy of textExtract

- [#413](https://github.com/browserbase/stagehand/pull/413) [`737b4b2`](https://github.com/browserbase/stagehand/commit/737b4b208c9214e8bb22535ab7a8daccf37610d9) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - remove topMostElement check when verifying visibility of text nodes

- [#388](https://github.com/browserbase/stagehand/pull/388) [`e93561d`](https://github.com/browserbase/stagehand/commit/e93561d7875210ce7bd7fe841fb52decf6011fb3) Thanks [@kamath](https://github.com/kamath)! - Export LLMClient type

## 1.9.0

### Minor Changes

- [#374](https://github.com/browserbase/stagehand/pull/374) [`207244e`](https://github.com/browserbase/stagehand/commit/207244e3a46c4474d4d28db039eab131164790ca) Thanks [@sameelarif](https://github.com/sameelarif)! - Pass in a Stagehand Page object into the `on("popup")` listener to allow for multi-page handling.

- [#367](https://github.com/browserbase/stagehand/pull/367) [`75c0e20`](https://github.com/browserbase/stagehand/commit/75c0e20cde54951399753e0fa841df463e1271b8) Thanks [@kamath](https://github.com/kamath)! - Logger in LLMClient is inherited by default from Stagehand. Named rather than positional arguments are used in implemented LLMClients.

- [#381](https://github.com/browserbase/stagehand/pull/381) [`db2ef59`](https://github.com/browserbase/stagehand/commit/db2ef5997664e81b1dfb5ca992392362f2d3bab1) Thanks [@kamath](https://github.com/kamath)! - make logs only sync

- [#385](https://github.com/browserbase/stagehand/pull/385) [`5899ec2`](https://github.com/browserbase/stagehand/commit/5899ec2c4b73c636bfd8120ec3aac225af7dd949) Thanks [@sameelarif](https://github.com/sameelarif)! - Moved the LLMClient logger paremeter to the createChatCompletion method options.

- [#364](https://github.com/browserbase/stagehand/pull/364) [`08907eb`](https://github.com/browserbase/stagehand/commit/08907ebbc2cb47cfc3151946764656a7f4ce99c6) Thanks [@kamath](https://github.com/kamath)! - exposed llmClient in stagehand constructor

### Patch Changes

- [#383](https://github.com/browserbase/stagehand/pull/383) [`a77efcc`](https://github.com/browserbase/stagehand/commit/a77efccfde3a3948013eda3a52935e8a21d45b3e) Thanks [@sameelarif](https://github.com/sameelarif)! - Unified LLM input/output types for reduced dependence on OpenAI types

- [`b7b3701`](https://github.com/browserbase/stagehand/commit/b7b370160bf35b09f5dc132f6e86f6e34fb70a85) Thanks [@kamath](https://github.com/kamath)! - Fix $1-types exposed to the user

- [#353](https://github.com/browserbase/stagehand/pull/353) [`5c6f14b`](https://github.com/browserbase/stagehand/commit/5c6f14bade201e08cb86d2e14e246cb65707f7ee) Thanks [@kamath](https://github.com/kamath)! - Throw custom error if context is referenced without initialization, remove act/extract handler from index

- [#360](https://github.com/browserbase/stagehand/pull/360) [`89841fc`](https://github.com/browserbase/stagehand/commit/89841fc42ae82559baddfe2a9593bc3260c082a2) Thanks [@kamath](https://github.com/kamath)! - Remove stagehand nav entirely

- [#379](https://github.com/browserbase/stagehand/pull/379) [`b1c6579`](https://github.com/browserbase/stagehand/commit/b1c657976847de86d82324030f90c2f6a1f3f976) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - dont require LLM Client to use non-ai stagehand functions

- [#371](https://github.com/browserbase/stagehand/pull/371) [`30e7d09`](https://github.com/browserbase/stagehand/commit/30e7d091445004c71aec1748d3a7d75fb86d1f11) Thanks [@kamath](https://github.com/kamath)! - pretty readme :)

- [#382](https://github.com/browserbase/stagehand/pull/382) [`a41271b`](https://github.com/browserbase/stagehand/commit/a41271baf351e20f4c79b4b654d8a947b615a121) Thanks [@sameelarif](https://github.com/sameelarif)! - Added example implementation of the Vercel AI SDK as an LLMClient

- [#344](https://github.com/browserbase/stagehand/pull/344) [`c1cf345`](https://github.com/browserbase/stagehand/commit/c1cf34535ed30262989b1dbe262fb0414cdf8230) Thanks [@kamath](https://github.com/kamath)! - Remove duplicate logging and expose Page/BrowserContext types

## 1.8.0

### Minor Changes

- [#324](https://github.com/browserbase/stagehand/pull/324) [`cd23fa3`](https://github.com/browserbase/stagehand/commit/cd23fa33450107f29cb1ddb6edadfc769d336aa5) Thanks [@kamath](https://github.com/kamath)! - Move stagehand.act() -> stagehand.page.act() and deprecate stagehand.act()

- [#319](https://github.com/browserbase/stagehand/pull/319) [`bacbe60`](https://github.com/browserbase/stagehand/commit/bacbe608058304bfa1f0ab049da4d8aa90e8d6f7) Thanks [@kamath](https://github.com/kamath)! - We now wrap playwright page/context within StagehandPage and StagehandContext objects. This helps us augment the Stagehand experience by being able to augment the underlying Playwright

- [#324](https://github.com/browserbase/stagehand/pull/324) [`cd23fa3`](https://github.com/browserbase/stagehand/commit/cd23fa33450107f29cb1ddb6edadfc769d336aa5) Thanks [@kamath](https://github.com/kamath)! - moves extract and act -> page and deprecates stagehand.extract and stagehand.observe

### Patch Changes

- [#320](https://github.com/browserbase/stagehand/pull/320) [`c0cdd0e`](https://github.com/browserbase/stagehand/commit/c0cdd0e985d66f0464d2e70b7d0cb343b0efbd3f) Thanks [@kamath](https://github.com/kamath)! - bug fix: set this.env to LOCAL if BROWSERBASE_API_KEY is not defined

- [#325](https://github.com/browserbase/stagehand/pull/325) [`cc46f34`](https://github.com/browserbase/stagehand/commit/cc46f345c0a1dc0af4abae7e207833df17da50e7) Thanks [@pkiv](https://github.com/pkiv)! - only start domdebug if enabled

## 1.7.0

### Minor Changes

- [#316](https://github.com/browserbase/stagehand/pull/316) [`902e633`](https://github.com/browserbase/stagehand/commit/902e633e126a58b80b757ea0ecada01a7675a473) Thanks [@kamath](https://github.com/kamath)! - rename browserbaseResumeSessionID -> browserbaseSessionID

- [#296](https://github.com/browserbase/stagehand/pull/296) [`f11da27`](https://github.com/browserbase/stagehand/commit/f11da27a20409c240ceeea2003d520f676def61a) Thanks [@kamath](https://github.com/kamath)! - - Deprecate fields in `init` in favor of constructor options

  - Deprecate `initFromPage` in favor of `browserbaseResumeSessionID` in constructor
  - Rename `browserBaseSessionCreateParams` -> `browserbaseSessionCreateParams`

- [#304](https://github.com/browserbase/stagehand/pull/304) [`0b72f75`](https://github.com/browserbase/stagehand/commit/0b72f75f6a62aaeb28b0c488ae96db098d6a2846) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add textExtract: an optional, text based approach to the existing extract method. textExtract often performs better on long form extraction tasks. By default `extract` uses the existing approach `domExtract`.

- [#298](https://github.com/browserbase/stagehand/pull/298) [`55f0cd2`](https://github.com/browserbase/stagehand/commit/55f0cd2fe7976e800833ec6e41e9af62d88d09d5) Thanks [@kamath](https://github.com/kamath)! - Add sessionId to public params

### Patch Changes

- [#283](https://github.com/browserbase/stagehand/pull/283) [`b902192`](https://github.com/browserbase/stagehand/commit/b902192bc7ff8eb02c85150c1fe6f89c2a95b211) Thanks [@sameelarif](https://github.com/sameelarif)! - allowed customization of eval config via .env

- [#299](https://github.com/browserbase/stagehand/pull/299) [`fbe2300`](https://github.com/browserbase/stagehand/commit/fbe23007176488043c2415519f25021612fff989) Thanks [@sameelarif](https://github.com/sameelarif)! - log playwright actions for better debugging

## 1.6.0

### Minor Changes

- [#286](https://github.com/browserbase/stagehand/pull/286) [`9605836`](https://github.com/browserbase/stagehand/commit/9605836ee6b8207ed7dc9146e12ced1c78630d59) Thanks [@kamath](https://github.com/kamath)! - minor improvement in action + new eval case

- [#279](https://github.com/browserbase/stagehand/pull/279) [`d6d7057`](https://github.com/browserbase/stagehand/commit/d6d70570623a718354797ef83aa8489eacc085d1) Thanks [@kamath](https://github.com/kamath)! - Add support for o1-mini and o1-preview in OpenAIClient

- [#282](https://github.com/browserbase/stagehand/pull/282) [`5291797`](https://github.com/browserbase/stagehand/commit/529179724a53bf2fd578a4012fd6bc6b7348d1ae) Thanks [@kamath](https://github.com/kamath)! - Added eslint for stricter type checking. Streamlined most of the internal types throughout the cache, llm, and handlers. This should make it easier to add new LLMs down the line, maintain and update the existing code, and make it easier to add new features in the future. Types can be checked by running `npx eslint .` from the project directory.

### Patch Changes

- [#270](https://github.com/browserbase/stagehand/pull/270) [`6b10b3b`](https://github.com/browserbase/stagehand/commit/6b10b3b1160649b19f50d66588395ceb679b3d68) Thanks [@sameelarif](https://github.com/sameelarif)! - add close link to readme

- [#288](https://github.com/browserbase/stagehand/pull/288) [`5afa0b9`](https://github.com/browserbase/stagehand/commit/5afa0b940a9f379a3719a5bbae249dd2a9ef8380) Thanks [@kamath](https://github.com/kamath)! - add multi-region support for browserbase

- [#284](https://github.com/browserbase/stagehand/pull/284) [`474217c`](https://github.com/browserbase/stagehand/commit/474217cfaff8e68614212b66baa62d35493fd2ce) Thanks [@kamath](https://github.com/kamath)! - Build wasn't working, this addresses tsc failure.

- [#236](https://github.com/browserbase/stagehand/pull/236) [`85483fe`](https://github.com/browserbase/stagehand/commit/85483fe091544fc079015c62b6923b03f8b9caa7) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - reduce chunk size

## 1.5.0

### Minor Changes

- [#266](https://github.com/browserbase/stagehand/pull/266) [`0e8f34f`](https://github.com/browserbase/stagehand/commit/0e8f34fc15aee91c548d09534deaccc8adca7c4d) Thanks [@kamath](https://github.com/kamath)! - Install wasn't working from NPM due to misconfigured build step. This attempts to fix that.

## 1.4.0

### Minor Changes

- [#253](https://github.com/browserbase/stagehand/pull/253) [`598cae2`](https://github.com/browserbase/stagehand/commit/598cae230c7b8d4e31ae22fd63047a91b63e51b8) Thanks [@sameelarif](https://github.com/sameelarif)! - clean up contexts after use

### Patch Changes

- [#225](https://github.com/browserbase/stagehand/pull/225) [`a2366fe`](https://github.com/browserbase/stagehand/commit/a2366feb023180fbb2ccc7a8379692f9f8347fe5) Thanks [@sameelarif](https://github.com/sameelarif)! - Ensuring cross-platform compatibility with tmp directories

- [#249](https://github.com/browserbase/stagehand/pull/249) [`7d06d43`](https://github.com/browserbase/stagehand/commit/7d06d43f2b9a477fed35793d7479de9b183e8d53) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix broken evals

- [#227](https://github.com/browserbase/stagehand/pull/227) [`647eefd`](https://github.com/browserbase/stagehand/commit/647eefd651852eec495faa1b8f4dbe6b1da17999) Thanks [@kamath](https://github.com/kamath)! - Fix debugDom still showing chunks when set to false

- [#250](https://github.com/browserbase/stagehand/pull/250) [`5886620`](https://github.com/browserbase/stagehand/commit/5886620dd1b0a57c68bf810cf130df2ca0a50a69) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add ci specific evals

- [#222](https://github.com/browserbase/stagehand/pull/222) [`8dff026`](https://github.com/browserbase/stagehand/commit/8dff02674df7a6448f2262c7e212b58c03be57bc) Thanks [@sameelarif](https://github.com/sameelarif)! - Streamline type definitions and fix existing typescript errors

- [#232](https://github.com/browserbase/stagehand/pull/232) [`b9f9949`](https://github.com/browserbase/stagehand/commit/b9f99494021e6a9e2487b77bb64ed0a491751400) Thanks [@kamath](https://github.com/kamath)! - Minor changes to package.json and tsconfig, mainly around the build process. Also add more type defs and remove unused dependencies.

## 1.3.0

### Minor Changes

- [#195](https://github.com/browserbase/stagehand/pull/195) [`87a6305`](https://github.com/browserbase/stagehand/commit/87a6305d9a2faf1ab5915965913bc14d5cc15772) Thanks [@kamath](https://github.com/kamath)! - - Adds structured and more standardized JSON logging
  - Doesn't init cache if `enableCaching` is false, preventing `tmp/.cache` from being created
  - Updates bundling for browser-side code to support NextJS and serverless

## 1.2.0

### Minor Changes

- [#179](https://github.com/browserbase/stagehand/pull/179) [`0031871`](https://github.com/browserbase/stagehand/commit/0031871d5a6d6180f272a68b88a8634e5a991785) Thanks [@navidkpr](https://github.com/navidkpr)! - Fixes:

  The last big change we pushed out, introduced a small regression. As a result, the gray outline showing the elements Stagehand is looking out is missing. This commit fixes that. We now process selectorMap properly now (using the updated type Record<number, string[]

  Improved the action prompt:

  Improved the structure
  Made it more straightforward
  Improved working for completed arg and prioritized precision over recall

## 1.1.0

### Minor Changes

- [`9206ec6`](https://github.com/browserbase/stagehand/commit/9206ec640b2d0af9170f0a31788ab1eac448357b) Thanks [@kamath](https://github.com/kamath)! - Connect to a minor session
