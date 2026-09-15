import { defineConfig } from "oxlint";

export default defineConfig({
  // Each example installs its own dependencies and may use an older SDK.
  options: { typeAware: false },
  rules: { "no-console": "off" },
});
