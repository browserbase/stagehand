import path from "node:path";
import { verifyPreviewBundle } from "./preview-contract.js";

const directory = process.argv[2];
if (directory === undefined) {
  throw new Error("Pass the preview bundle directory to verify");
}

const manifest = await verifyPreviewBundle(path.resolve(directory));
process.stdout.write(
  `Verified Stagehand preview ${manifest.commitSha} for PR #${manifest.pullRequest}\n`,
);
