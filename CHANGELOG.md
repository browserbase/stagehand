# @browserbasehq/stagehand

## 2.5.1

### Patch Changes

- [#1082](https://github.com/browserbase/stagehand/pull/1082) [`8c0fd01`](https://github.com/browserbase/stagehand/commit/8c0fd01c965a809b96c026f4674685e6445bc7d4) Thanks [@tkattkat](https://github.com/tkattkat)! - Pass stagehand object to agent instead of stagehand page

- [#1104](https://github.com/browserbase/stagehand/pull/1104) [`a1ad06c`](https://github.com/browserbase/stagehand/commit/a1ad06c5398db10db7a2a83075b808dc63a963f7) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix logging for stagehand agent

- [#1066](https://github.com/browserbase/stagehand/pull/1066) [`9daa584`](https://github.com/browserbase/stagehand/commit/9daa58477111e1470f2b618a898738b5e1967cb6) Thanks [@tkattkat](https://github.com/tkattkat)! - Add playwright arguments to agent execute response

- [#1077](https://github.com/browserbase/stagehand/pull/1077) [`7f38b3a`](https://github.com/browserbase/stagehand/commit/7f38b3a3048ba28f81649c33c0d633c4853146bd) Thanks [@tkattkat](https://github.com/tkattkat)! - adds support for stagehand agent in the api

- [#1032](https://github.com/browserbase/stagehand/pull/1032) [`bf2d0e7`](https://github.com/browserbase/stagehand/commit/bf2d0e79da744b6b2a82d60e1ad05ca9fa811488) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix for zod peer dependency support

- [#1014](https://github.com/browserbase/stagehand/pull/1014) [`6966201`](https://github.com/browserbase/stagehand/commit/6966201e2511eb897132d237d0b7712b48b3c7ab) Thanks [@tkattkat](https://github.com/tkattkat)! - Replace operator handler with base of new agent

- [#1089](https://github.com/browserbase/stagehand/pull/1089) [`536f366`](https://github.com/browserbase/stagehand/commit/536f366f868d115ffa84c2c92124ae05400dd8be) Thanks [@miguelg719](https://github.com/miguelg719)! - Fixed info logs on api session create

- [#1103](https://github.com/browserbase/stagehand/pull/1103) [`889cb6c`](https://github.com/browserbase/stagehand/commit/889cb6cec27f0fc07286a9263bdc4d559149a037) Thanks [@tkattkat](https://github.com/tkattkat)! - patch custom tool support in anthropic cua client

- [#1056](https://github.com/browserbase/stagehand/pull/1056) [`6a002b2`](https://github.com/browserbase/stagehand/commit/6a002b234dbf1ac7d1f180eeffdf66154fa7799b) Thanks [@chrisreadsf](https://github.com/chrisreadsf)! - remove need for duplicate project id if already passed to Stagehand

- [#1090](https://github.com/browserbase/stagehand/pull/1090) [`8ff5c5a`](https://github.com/browserbase/stagehand/commit/8ff5c5a4b2050fc581240ae1befcdc0cf9195873) Thanks [@miguelg719](https://github.com/miguelg719)! - Improve failed act error logs

- [#1014](https://github.com/browserbase/stagehand/pull/1014) [`6966201`](https://github.com/browserbase/stagehand/commit/6966201e2511eb897132d237d0b7712b48b3c7ab) Thanks [@tkattkat](https://github.com/tkattkat)! - replace operator agent with scaffold for new stagehand agent

- [#1102](https://github.com/browserbase/stagehand/pull/1102) [`a99aa48`](https://github.com/browserbase/stagehand/commit/a99aa48936ae3ce113172bce673809eaf5ef7ac1) Thanks [@miguelg719](https://github.com/miguelg719)! - Add current page and date context to agent

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
