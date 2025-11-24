# @browserbasehq/stagehand

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
