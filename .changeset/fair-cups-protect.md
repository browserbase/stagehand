---
"@browserbasehq/stagehand": patch
---

Remove automatic `.env` loading via `dotenv`.

If your app relies on `.env` files, install `dotenv` and load it explicitly in your code:

```ts
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
```
