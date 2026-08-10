import { Args } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import { fail } from "../../lib/errors.js";
import { installSkill } from "../../lib/skills/install.js";

export default class SkillsAdd extends BrowseCommand {
  static override description = "Install a browser automation skill.";

  static override examples = [
    "browse skills add yelp.com/extract-reviews",
    "browse skills add mcdonalds.order.online/order-delivery-42q71n",
  ];

  static override args = {
    // Intentionally optional so we can emit actionable guidance instead of
    // oclif's bare "Missing 1 required arg" error.
    skill: Args.string({
      required: false,
      description: "Skill id in the form <domain>/<task>.",
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SkillsAdd);
    if (!args.skill) {
      fail(
        "Missing skill id. Pass a skill in the form <domain>/<task>, e.g. `browse skills add yelp.com/extract-reviews`. Run `browse skills find <query>` to discover skills.",
        2,
        { resultCode: "invalid_skill_id" },
      );
    }
    await installSkill(args.skill);
  }
}
