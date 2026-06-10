import { Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  type DriverFlags,
} from "../lib/driver/command-cli.js";
import { buildDoctorReport, renderDoctorReport } from "../lib/driver/doctor.js";
import { sessionName } from "../lib/driver/flags.js";
import { outputJson } from "../lib/output.js";

export default class Doctor extends BrowseCommand {
  static override description =
    "Diagnose browse driver session and browser connection prerequisites.";

  static override examples = [
    "browse doctor",
    "browse doctor --remote",
    "browse doctor --auto-connect",
    "browse doctor --cdp 9222",
    "browse doctor --session research --json",
  ];

  static override flags = {
    ...driverCommandFlags,
    json: Flags.boolean({
      description: "Emit structured JSON for agents and CI. Always exits 0.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Doctor);
    const session = sessionName(flags.session);
    const report = await buildDoctorReport({
      flags: flags as DriverFlags,
      session,
    });

    if (flags.json) {
      outputJson(report);
      return;
    }

    this.log(renderDoctorReport(report));
    if (report.verdict === "fail") this.exit(1);
  }
}
