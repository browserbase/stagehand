import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Chromium source revision: de0f42384e7b53ba61eefe0ecda7f17f406bde13
// components/optimization_guide/proto/features/common_quality_data.proto
// Requires protoc with edition 2023 support. The ES generator is pinned in the workspace catalog.
// Run: pnpm --filter @browserbasehq/stagehand-extension generate:apc
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const schemaDir = path.join(packageDir, "understudy/annotatedPageContent");
const schema = path.join(schemaDir, "common_quality_data.proto");
execFileSync(
  "protoc",
  [
    "--plugin=protoc-gen-es=" + path.join(packageDir, "node_modules/.bin/protoc-gen-es"),
    "--es_out=" + schemaDir,
    "--es_opt=target=ts,json_types=true",
    "-I",
    schemaDir,
    schema,
  ],
  { stdio: "inherit" },
);

// Encode independently of the JS runtime so the decoder test checks the actual wire format.
const bytes = execFileSync(
  "protoc",
  ["--encode=optimization_guide.proto.AnnotatedPageContent", "-I", schemaDir, schema],
  { input: readFileSync(path.join(schemaDir, "fixtures/content.textproto")) },
);
writeFileSync(path.join(schemaDir, "fixtures/content.base64"), bytes.toString("base64") + "\n");
execFileSync(
  "pnpm",
  ["exec", "oxfmt", "--write", path.join(schemaDir, "common_quality_data_pb.ts")],
  {
    cwd: packageDir,
    stdio: "inherit",
  },
);
