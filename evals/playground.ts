import { Stagehand } from "../lib";
import { z } from "zod";

// eval failing
const arxiv = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 1, debugDom: true, headless: process.env.HEADLESS !== "false" });

  await stagehand.init({ modelName: "gpt-4o-2024-08-06" });

  interface Paper {
    title: string;
    link: string | null;
    category: string | null;
    problem: string | null;
    methodology: string | null;
    results: string | null;
    conclusion: string | null;
    code: string | null;
  }

  const papers: Paper[] = [];

  try {
    await stagehand.page.goto("https://arxiv.org/search/");
    await stagehand.waitForSettledDom();

    // await stagehand.act({ action: "search for papers about web agents with multimodal models" }); 
    await stagehand.act({ action: "search for papers about multimodal models" }); 
    await stagehand.waitForSettledDom();

    const paper_links = await stagehand.extract({
        instruction: "extract the titles and links for all papers",
        completionCondition: "stop when you have extracted two papers",
        schema: z.object({
          papers: z.array(z.object({
            title: z.string().describe("the title of the paper"),
            link: z.string().describe("the link to the paper").nullable(),
          })).describe("list of papers"),
        }),
        modelName: "gpt-4o-2024-08-06",
    });

    if (!paper_links || !paper_links.papers || paper_links.papers.length === 0) {
      return false;
    }

    console.log(paper_links);
  
    // return true;
    for (const paper of paper_links.papers) {
        if (paper.link) {
          await stagehand.page.goto(paper.link);
          const abstract = await stagehand.extract({
            instruction: "extract details of the paper from the abstract",
            completionCondition: "stop when you have extracted information about the abstract",
            schema: z.object({
              category: z.string().describe("the category of the paper. one of {'Benchmark', 'Dataset', 'Model', 'Framework', 'System', 'Other'}"),
              problem: z.string().describe("summarize the problem that the paper is trying to solve in one sentence").nullable(),
              methodology: z.string().describe("summarize the methodology of the paper in one sentence").nullable(),
              results: z.string().describe("summarize the results of the paper in one sentence").nullable(),
              conclusion: z.string().describe("summarize the conclusion of the paper in one sentence").nullable(),
              code: z.string().describe("if provided, extract only the link to the code repository, without additional text. this is often optional and not always provided.").nullable(),
            }),
            modelName: "gpt-4o-2024-08-06"
          });
    
          papers.push({
            title: paper.title,
            link: paper.link,
            category: abstract.category,
            problem: abstract.problem,
            methodology: abstract.methodology,
            results: abstract.results,
            conclusion: abstract.conclusion,
            code: abstract.code,
          });
        }
    }

    if (!papers || papers.length === 0) {
      return false;
    }

    console.log(papers);
    return true;

  } catch (error) {
    console.error(`Error in arxiv function: ${error.message}`);
    return false;
  } finally {
    await stagehand.context.close();
  }
};

async function main() {
  const arxivResult = await arxiv();

  console.log("Result:", arxivResult);
}

main().catch(console.error);
