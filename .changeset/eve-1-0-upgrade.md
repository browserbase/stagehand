---
"@browserbasehq/eve": minor
---

Rebuild extension for eve 1.0.0-rc.6 compatibility.

**BREAKING**: Peer dependency changed from `^0.71.2` to `^1.0.0-rc.0`. This extension now requires eve 1.0.x and will not work with earlier versions. Per eve's extension contract, an extension built with eve 1.0 requires eve 1.0 or later at runtime.

Changes:

- Updated workspace catalog from eve 0.71.2 to eve 1.0.0-rc.6
- Updated ai peer dependency from ^7.0.105 to ^7.0.137 (eve 1.0's peer requirement)
- Changed peer dependency from `^0.71.2` to `^1.0.0-rc.0`
- Extension now builds with eve 1.0 manifest format (formatVersion: 3)
- Added structural compatibility tests for eve 1.0 manifest and tool schemas

Note: Browser E2E tests (run/snapshot/screenshot against real browsers) require BROWSERBASE_API_KEY. This extension uses Browserbase exclusively; there is no local browser mode.
