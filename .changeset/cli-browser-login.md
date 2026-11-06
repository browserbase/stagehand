---
"browse": minor
---

Add device-code sign-in with `browse login`, including project selection and saved credentials for subsequent commands. Store credentials in the OS keystore when available, with an automatic private-file fallback on macOS and Linux. Use `browse auth status` to inspect the saved login and `browse logout` to remove it. Approve sign-in from any browser, including when the CLI runs over SSH. Use `--no-browser` to open the approval link yourself and `--project-id` to select a permitted project without the terminal picker.
