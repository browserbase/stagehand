import { Args } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import { installSkill } from "../../lib/skills/install.js";

export default class SkillsAdd extends BrowseCommand {
  static override description = "Install a browser automation skill.";

  static override examples = [
    "browse skills add yelp.com/extract-reviews",
    "browse skills add mcdonalds.order.online/order-delivery-42q71n",
  ];

  static override args = {
    skill: Args.string({
      required: true,
      description: "Skill id in the form <domain>/<task>.",
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SkillsAdd);
    const exitCode = await installSkill(args.skill);
    if (exitCode !== 0) {
      this.exit(exitCode);
    }
  }
}
