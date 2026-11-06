---
"@browserbasehq/eve": minor
---

Upgrade eve dependency to 1.0.0-rc.6 for compatibility with Vercel eve 1.0 release.

- Updated workspace catalog from eve 0.71.2 to eve 1.0.0-rc.6
- Updated ai peer dependency requirement from ^7.0.105 to ^7.0.137 (eve 1.0's peer)
- Widened peer dependency range to support both 0.71.2+ and 1.0.0-rc.x
- Extension now builds with eve 1.0 manifest format (formatVersion: 3)
- Added E2E compatibility tests for eve 1.0 extension loading and tool validation
- All existing native Code Mode tools (run/snapshot/screenshot) work unchanged

This upgrade follows the eve 1.0 upgrade guide. Extensions built with eve <=0.83 must be rebuilt for 1.0; this release rebuilds the extension with eve 1.0.0-rc.6. No API changes are required for users mounting this extension.
