# @browserbasehq/stagehand-lib

## 2.4.0

### Minor Changes

- [#778](https://github.com/browserbase/stagehand/pull/778) [`df570b6`](https://github.com/browserbase/stagehand/commit/df570b67e46febcaf7282ffb65dd5707e2808152) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - iframe support

### Patch Changes

- [#809](https://github.com/browserbase/stagehand/pull/809) [`03ebebc`](https://github.com/browserbase/stagehand/commit/03ebebc0317f92d8de77285cc2e66dc0131fe9fe) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - log NoObjectGenerated error details

- [#801](https://github.com/browserbase/stagehand/pull/801) [`1d4f0ab`](https://github.com/browserbase/stagehand/commit/1d4f0abca47bf47ae8b7aeb53f3cd1155a7e5448) Thanks [@miguelg719](https://github.com/miguelg719)! - Default use API to true

- [#798](https://github.com/browserbase/stagehand/pull/798) [`d86200b`](https://github.com/browserbase/stagehand/commit/d86200bd5bde4c5ba113ca89e28ab86c14a8304e) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix pino logging memory leak by reusing worker

## 2.3.0

### Minor Changes

- [#731](https://github.com/browserbase/stagehand/pull/731) [`393c8e0`](https://github.com/browserbase/stagehand/commit/393c8e05d016086e481c0043ee6b084c61886cad) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - make extract() with no arguments return the hybrid tree instead of text-rendered webpage

- [#737](https://github.com/browserbase/stagehand/pull/737) [`6ef6073`](https://github.com/browserbase/stagehand/commit/6ef60730cab0ad9025f44b6eeb2c83751d1dcd35) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - deprecate useTextExtract and remove functionality

### Patch Changes

- [#741](https://github.com/browserbase/stagehand/pull/741) [`5680d25`](https://github.com/browserbase/stagehand/commit/5680d2509352c383ad502c9f4fabde01fa638833) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - use safeparse for zod validation

- [#740](https://github.com/browserbase/stagehand/pull/740) [`28840a7`](https://github.com/browserbase/stagehand/commit/28840a7d3fec89a490984582fb37fa3d007c0349) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - dont log deprecation warning when onlyVisible is undefined

- [#755](https://github.com/browserbase/stagehand/pull/755) [`ba687ab`](https://github.com/browserbase/stagehand/commit/ba687abdfb598f839ddfec0442d3d7b6b696b0a3) Thanks [@miguelg719](https://github.com/miguelg719)! - Fix context init error on undefined context

- [#789](https://github.com/browserbase/stagehand/pull/789) [`c5ff8ce`](https://github.com/browserbase/stagehand/commit/c5ff8ce2d7467b70a450ca52bc3e03b15280ce1b) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix noisy useTextExtract deprecation log

- [#757](https://github.com/browserbase/stagehand/pull/757) [`628e534`](https://github.com/browserbase/stagehand/commit/628e534ea6d7ca081bad6c32167c7d53d4772eed) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - optimize CDP calls when building hybrid tree

- [#772](https://github.com/browserbase/stagehand/pull/772) [`64d331d`](https://github.com/browserbase/stagehand/commit/64d331dc2eba86675a8b148d361897f55f170703) Thanks [@miguelg719](https://github.com/miguelg719)! - Fixes an issue with the new tab intercepts for invalid urls

- [#770](https://github.com/browserbase/stagehand/pull/770) [`d312a43`](https://github.com/browserbase/stagehand/commit/d312a43672fe2865abcf184a712a759a12f5b9d1) Thanks [@miguelg719](https://github.com/miguelg719)! - Removed default chromium flags that delay browser launching

- [#753](https://github.com/browserbase/stagehand/pull/753) [`fbca400`](https://github.com/browserbase/stagehand/commit/fbca4003a547dc5eee0c0be5edc5e98c1f4d8c22) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix `stagehand.history`

- [#745](https://github.com/browserbase/stagehand/pull/745) [`c54afab`](https://github.com/browserbase/stagehand/commit/c54afab0e43a2144eecbc56df7f33c5e444ceed5) Thanks [@miguelg719](https://github.com/miguelg719)! - Add an identifier for client language/runtime

- [#768](https://github.com/browserbase/stagehand/pull/768) [`58b06eb`](https://github.com/browserbase/stagehand/commit/58b06eb2fdfb1a9cd84c03f46655ab0ea00ee07f) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix: page.evaluate: Execution context was destroyed, most likely because of a navigation

- [#758](https://github.com/browserbase/stagehand/pull/758) [`98e1356`](https://github.com/browserbase/stagehand/commit/98e13566846a547003e4c9aebbe4f95eff653bba) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - rm unused functions

- [#781](https://github.com/browserbase/stagehand/pull/781) [`8d239ce`](https://github.com/browserbase/stagehand/commit/8d239cec7a835d35243b2b00c3c00c1b66c05b5e) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix variable parsing issue with gpt-4.1

- [#761](https://github.com/browserbase/stagehand/pull/761) [`e1f7074`](https://github.com/browserbase/stagehand/commit/e1f7074be23c82ae897386d5e5e132ff8cb4120a) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - build xpaths on node side instead of using injected JS

## 2.2.1

### Patch Changes

- [#729](https://github.com/browserbase/stagehand/pull/729) [`fc24f84`](https://github.com/browserbase/stagehand/commit/fc24f848ee0f300182e88993dfe8d68025d69fcb) Thanks [@seanmcguire12](https://github.com/seanmcguire12)! - fix "failed to inject helper scripts" log on stagehand.close()
