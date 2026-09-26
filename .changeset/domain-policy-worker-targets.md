---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-go": patch
---

Requests issued from a service worker now go through `setDomainPolicy`. A service worker is its own CDP target, so the page-session Fetch interception never saw it, and a worker could reach a blocked or non-allowed host while the page that started it could not.
