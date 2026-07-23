import { definePlugin } from "@oxlint/plugins";
import { noLocalProtocolSchemaInference } from "./no-local-protocol-schema-inference.ts";
import { noLooseJsonSchemaInProtocolOperations } from "./no-loose-json-schema-in-protocol-operations.ts";
import { noRenamedImports } from "./no-renamed-imports.ts";

const STAGEHAND_OXLINT_PLUGIN_NAME = "stagehand";

const plugin = definePlugin({
  meta: { name: STAGEHAND_OXLINT_PLUGIN_NAME },
  rules: {
    "no-local-protocol-schema-inference": noLocalProtocolSchemaInference,
    "no-loose-json-schema-in-protocol-operations": noLooseJsonSchemaInProtocolOperations,
    "no-renamed-imports": noRenamedImports,
  },
});

export const stagehandRuleConfig = {
  "stagehand/no-local-protocol-schema-inference": "error",
  "stagehand/no-loose-json-schema-in-protocol-operations": "error",
  "stagehand/no-renamed-imports": "error",
} as const;

export default plugin;
