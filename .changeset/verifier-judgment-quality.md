---
"@browserbasehq/stagehand": patch
---

Improve verifier judgment quality: the per-blob canonical-evidence cap is env-tunable (VERIFIER_CANONICAL_EVIDENCE_CHARS, lifted by VERIFIER_DISABLE_TRUNCATION) so large aria trees no longer cause false negatives, and required-field grading trusts the visual required marker instead of duplicated aria attributes.
