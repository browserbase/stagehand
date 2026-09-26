---
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand-protocol": patch
---

Keep telemetry disabled unless an OTLP traces endpoint is explicitly configured.

Generated initialization models now represent telemetry as optional. Go callers constructing `StagehandInitParams` directly must pass a `*TelemetryConfig` instead of a `TelemetryConfig`; `CreateOptions.Telemetry` remains value-style.
