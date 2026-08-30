---
"@browserbasehq/stagehand": major
"@browserbasehq/stagehand-protocol": patch
---

require extract() schemas that both validate and convert to JSON Schema

`extract()` now takes schemas that validate values and produce Draft 2020-12 JSON Schema. Zod 4.2.0+ and ArkType pass through. Wrap Valibot with `toStandardJsonSchema()`, Effect with both of its Standard Schema adapters, and JSON Schema objects that follow Draft 2020-12 with `jsonSchema()`.

Breaking for TypeScript:

- Zod older than 4.2.0 is rejected. Validate-only Standard Schema implementations are rejected.
- Stagehand rejects fields that are not declared in an object schema. Set `additionalProperties: true` to allow undeclared fields.
- Conversion failures throw `StagehandSchemaError` before the browser call. Failed validation throws `StagehandValidationError`.
