---
"@browserbasehq/stagehand-server-v3": patch
---

Rebuild the standalone server binaries with Node.js 24.22.1 and Undici 7.30.1 to include the October 2026 security fixes. Binary builds now reject outdated Node versions and rebuild instead of reusing cached executables.
