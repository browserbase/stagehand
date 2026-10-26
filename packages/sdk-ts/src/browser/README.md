# Stagehand browser module

This TypeScript SDK module defines the browser lifecycle boundary proposed for
Stagehand v4. Browser factories in this directory own launch/connect behavior,
extension readiness, and the lifetime of their CDP transport.

The intended public SDK shape is:

```ts
const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({ browser, model });
```

`localBrowser` and `browserbase` each support `launch()` for resources owned by
the handle and `connect()` for existing resources. Both produce a nominal
`StagehandBrowser` whose extension must be ready before the promise resolves.

The browser API remains TypeScript-local for v4. Other SDKs can implement the
same protocol-backed shape independently, and shared packaging can follow once
the language implementations have stabilized.
