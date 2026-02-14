# @browserbasehq/stagehand

## 3.1.0

### Minor Changes

- [#1672](https://github.com/browserbase/stagehand/pull/1672) [`b65756e`](https://github.com/browserbase/stagehand/commit/b65756e9e85643055446aa4a51956f7d6627c89f) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - add boolean keepAlive parameter to allow for configuring whether the browser should be closed when stagehand.close() is called.

- [#1611](https://github.com/browserbase/stagehand/pull/1611) [`8a3c066`](https://github.com/browserbase/stagehand/commit/8a3c06600a9ba98485db7e9ed5c3cc43ea180334) Thanks [@monadoid](https://github.com/monadoid)! - Using `mode` enum instead of old `cua` boolean in openapi spec

### Patch Changes

- [#1683](https://github.com/browserbase/stagehand/pull/1683) [`7584f3e`](https://github.com/browserbase/stagehand/commit/7584f3e92e60a557d2b3e0e0d2a2af04c3527523) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: include shadow DOM in .count() & .nth() & support xpath predicates

- [#1644](https://github.com/browserbase/stagehand/pull/1644) [`1e1c9c1`](https://github.com/browserbase/stagehand/commit/1e1c9c15773e49d5c3cd36021dbc1d23495c1bce) Thanks [@monadoid](https://github.com/monadoid)! - Fix unhandled CDP detaches by returning the original sendCDP promise

- [#1647](https://github.com/browserbase/stagehand/pull/1647) [`ffd4b33`](https://github.com/browserbase/stagehand/commit/ffd4b335a873d0f4dcd76ea22d44f47919bf8e49) Thanks [@tkattkat](https://github.com/tkattkat)! - Fix [Agent] - Address bug causing issues with continuing a conversation from past messages in dom mode

- [#1614](https://github.com/browserbase/stagehand/pull/1614) [`677bff5`](https://github.com/browserbase/stagehand/commit/677bff5834c879a2d95f7dbff918b8e1510516b3) Thanks [@miguelg719](https://github.com/miguelg719)! - Enforce <number>-<number> regex validation on act/observe for elementId

- [#1666](https://github.com/browserbase/stagehand/pull/1666) [`101bcf2`](https://github.com/browserbase/stagehand/commit/101bcf2da8b527fd6ace6aa291ada5d0f2d90344) Thanks [@Kylejeong2](https://github.com/Kylejeong2)! - add support for codex models

- [#1664](https://github.com/browserbase/stagehand/pull/1664) [`b27c04d`](https://github.com/browserbase/stagehand/commit/b27c04d278c290364347acd0c354a878ea9b7c2d) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fixes issue with context.addInitScript() where scripts were not being applied to out of process iframes (OOPIFs), and popup pages with same process iframes (SPIFs)

- [#1624](https://github.com/browserbase/stagehand/pull/1624) [`0e8d569`](https://github.com/browserbase/stagehand/commit/0e8d5695f662040f7384e64f46301152802e3c62) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix issue where screenshot masks were not being applied to dialog elements

- [#1596](https://github.com/browserbase/stagehand/pull/1596) [`ff0f979`](https://github.com/browserbase/stagehand/commit/ff0f9795f3b2c1cf4f2610a80ebcb3341a24f987) Thanks [@tkattkat](https://github.com/tkattkat)! - Update usage/metrics handling in agent

- [#1631](https://github.com/browserbase/stagehand/pull/1631) [`2d89d2b`](https://github.com/browserbase/stagehand/commit/2d89d2b35ce812431956b28e0c8b52d32ddc7a27) Thanks [@miguelg719](https://github.com/miguelg719)! - Add right and middle click support to act and observe

- [#1613](https://github.com/browserbase/stagehand/pull/1613) [`aa4d981`](https://github.com/browserbase/stagehand/commit/aa4d981e440bdd0e3d3f42ccc310d5958aa25cc6) Thanks [@miguelg719](https://github.com/miguelg719)! - SupportedUnderstudyAction Enum validation for 'method' on act/observe inference

- [#1652](https://github.com/browserbase/stagehand/pull/1652) [`18b1e3b`](https://github.com/browserbase/stagehand/commit/18b1e3bd2b16b721845d52fcf1a45c6158e2403f) Thanks [@miguelg719](https://github.com/miguelg719)! - Add support for gemini 3 flash and pro in hybrid/cua agent

- [#1633](https://github.com/browserbase/stagehand/pull/1633) [`22e371a`](https://github.com/browserbase/stagehand/commit/22e371ae4c25deb6350328fe02832bf2b2197b94) Thanks [@tkattkat](https://github.com/tkattkat)! - Add warning when incorrect models are used with agents hybrid mode

- [#1609](https://github.com/browserbase/stagehand/pull/1609) [`3f9ca4d`](https://github.com/browserbase/stagehand/commit/3f9ca4d9acc109101357378d29cf969168991608) Thanks [@miguelg719](https://github.com/miguelg719)! - Add SupportedUnderstudyActions to observe system prompt

- [#1642](https://github.com/browserbase/stagehand/pull/1642) [`3673369`](https://github.com/browserbase/stagehand/commit/36733691f90c15386cf2a7b47d04ef429b7195ae) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix issue where scripts added via context.addInitScripts() were not being injected into new pages that were opened via popups (eg, clicking a link that opens a new page) and/or calling context.newPage(url)

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
