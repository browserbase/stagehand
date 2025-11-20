import StagehandSDKDefaultExport, * as StagehandSDK from "../../../ts-sdk/dist/index.js";
import { runExportSurfaceSuite } from "../../../../tests/shared/exportSurfaceSuite";

runExportSurfaceSuite(
  "Stagehand SDK public API export surface",
  StagehandSDK,
  StagehandSDKDefaultExport,
);
