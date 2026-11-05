---
"browse": minor
---

Add interactive browser sign-in with `browse login`, including project selection and saved credentials for subsequent commands. Store credentials in the OS keystore when available, with an automatic private-file fallback on macOS and Linux. Use `browse auth status` to inspect the saved login and `browse logout` to remove it. Use `--no-browser` to open the sign-in link yourself and `--project-id` to select a permitted project without the terminal picker.
