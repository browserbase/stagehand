import type { Page, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

// Three applicant tracking systems, five different page structures.
const BOARDS = [
  { company: "Figma", ats: "Greenhouse", url: "https://job-boards.greenhouse.io/figma" },
  { company: "Vercel", ats: "Greenhouse", url: "https://job-boards.greenhouse.io/vercel" },
  { company: "Notion", ats: "Ashby", url: "https://jobs.ashbyhq.com/notion" },
  { company: "Ramp", ats: "Ashby", url: "https://jobs.ashbyhq.com/ramp" },
  { company: "Palantir", ats: "Lever", url: "https://jobs.lever.co/palantir" },
];

const role = z.object({
  title: z.string(),
  team: z.string().nullable(),
  location: z.string(),
  url: z.url(),
});

export const schema = z.object({
  roles: z.array(role.extend({ company: z.string(), ats: z.string() })),
});

export async function run(stagehand: Stagehand, page: Page): Promise<z.output<typeof schema>> {
  const roles = [];
  for (const board of BOARDS) {
    await page.goto(board.url);
    const { data } = await stagehand.extract(
      "Every software engineering role on this job board that can be done remotely, with the link to its posting",
      z.object({ roles: z.array(role) }),
      { page },
    );
    for (const found of data.roles) {
      roles.push({
        ...found,
        company: board.company,
        ats: board.ats,
      });
    }
  }
  return { roles };
}
