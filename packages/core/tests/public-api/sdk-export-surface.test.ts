import StagehandSDKDefaultExport, * as StagehandSDK from "../../../sdk/dist/index.js";
import { runExportSurfaceSuite } from "../../../../tests/shared/exportSurfaceSuite";

runExportSurfaceSuite(
  "Stagehand SDK public API export surface",
  StagehandSDK,
  StagehandSDKDefaultExport,
);
