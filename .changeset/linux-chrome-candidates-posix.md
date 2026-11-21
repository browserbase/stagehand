---
"@browserbasehq/stagehand": patch
---

Build Linux Chrome executable candidates with POSIX path semantics on every host. The Linux branch of `chromeCandidates` used the host's `path.join`/`path.delimiter`, so discovering Chrome for a Linux platform from a Windows host produced backslash paths and split `PATH` on `;`, making `launchLocalBrowser` throw "Chrome installation not found; set CHROME_PATH".
