# @browserbasehq/stagehand

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
