---
"browse": patch
---

Harden daemon directory checks to reject empty paths, symlinks, non-directories, and, on Unix, foreign-owned directories or unsafe parent locations.
