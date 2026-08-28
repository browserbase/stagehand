---
"@browserbasehq/stagehand": major
"@browserbasehq/stagehand-protocol": patch
---

require extract() schemas that both validate and convert to JSON Schema

`extract()` now takes schemas that validate values and produce Draft 2020-12 JSON Schema. Zod 4.2.0+ and ArkType pass through. Wrap Valibot with `toStandardJsonSchema()`, Effect with both of its Standard Schema adapters, and TypeBox or raw JSON Schema with `jsonSchema()`.

Breaking for TypeScript:

- Zod older than 4.2.0 is rejected. Validate-only Standard Schema implementations are rejected.
- Objects that omit `additionalProperties` are sent with `additionalProperties: false`.
- Conversion failures throw `StagehandSchemaError` before the browser call. Failed validation throws `StagehandValidationError`.
