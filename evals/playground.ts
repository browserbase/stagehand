
import { Stagehand } from "../lib";
import { z } from "zod";

async function extractPartners() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    debugDom: true,
  });

  await stagehand.init({ modelName: "gpt-4o" });

  await stagehand.page.goto("https://ramp.com");

    await stagehand.act({
      action:
        "Close the popup.",
    });

    await stagehand.act({
      action:
        "Scroll down to the bottom of the page.",
    });


    await stagehand.act({
      action:
        "Click on the link or button that leads to the partners page. If it's in a dropdown or hidden section, first interact with the element to reveal it, then click the link.",
    });

    // await stagehand.page.waitForLoadState("networkidle");
    await stagehand.waitForSettledDom();

    // Scroll through the partners page
    // await stagehand.page.evaluate(() =>
    //   window.scrollTo(0, document.body.scrollHeight),
    // );
    await stagehand.page.waitForTimeout(2000);

    const partners = await stagehand.extract({
      instruction: `
        Extract the names of all partner companies mentioned on this page.
        These could be inside text, links, or images representing partner companies.
        If no specific partner names are found, look for any sections or categories of partners mentioned.
        Also, check for any text that explains why partner names might not be listed, if applicable.
      `,
      schema: z.object({
        partners: z.array(
          z.object({
            name: z
              .string()
              .describe(
                "The name of the partner company or category of partners",
              ),
          }),
        ),
        explanation: z
          .string()
          .optional()
          .describe("Any explanation about partner listing or absence thereof"),
      }),
      modelName: "gpt-4o",
    });

    const expectedPartners = [
      "accounting firms",
      "private equity and venture capital",
      "services providers",
      "affiliates"
    ];

    if (partners.explanation) {
      console.log("Explanation:", partners.explanation);
    }

    const foundPartners = partners.partners.map(partner => partner.name.toLowerCase());

    const allExpectedPartnersFound = expectedPartners.every(partner => 
      foundPartners.includes(partner)
    );
    await stagehand.context.close();

    if (allExpectedPartnersFound) {
      console.log("All expected partners found. Test passed.");
      return true;
    } else {
      console.log("Not all expected partners were found. Test failed.");
      console.log("Expected:", expectedPartners);
      console.log("Found:", foundPartners);
      return false;
    }

    
  }


(async () => {
  try {
    await extractPartners();
  } catch (error) {
    console.error("An error occurred:", error);
  }
})();