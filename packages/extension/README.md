# Server

Stagehand application code that runs inside the extension service worker.

`app.ts` composes the RPC router, controllers, services, and browser transports. The extension package owns the service-worker entry point that initializes the app.
