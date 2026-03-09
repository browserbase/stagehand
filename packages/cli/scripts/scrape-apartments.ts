import { Stagehand } from "@browserbasehq/stagehand";

interface Apartment {
  name: string;
  address: string;
  price: string;
  link: string;
}

async function scrapeApartments(
  city: string = "san-francisco-ca",
  bedrooms: number = 2,
): Promise<Apartment[]> {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
  });

  await stagehand.init();

  const page = stagehand.context.pages()[0];
  const url = `https://www.apartments.com/${city}/${bedrooms}-bedrooms/`;

  console.log(`Navigating to: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Wait for listings to load
  await page.waitForSelector("[data-listingid]", { timeout: 15000 });

  console.log("Extracting apartment listings...");

  // Use page.evaluate to extract data from the DOM
  const listings = await page.evaluate(() => {
    const cards = document.querySelectorAll("[data-listingid]");
    const results: Array<{
      name: string;
      address: string;
      price: string;
      link: string;
    }> = [];

    cards.forEach((card) => {
      const text = card.textContent || "";
      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const name = lines[0] || "";
      const address = lines[1] || "";

      const priceMatch = text.match(/\$[\d,]+\+?/);
      const price = priceMatch
        ? priceMatch[0]
        : text.includes("Call for Rent")
          ? "Call for Rent"
          : "";

      const anchor = card.querySelector("a");
      const link = anchor ? anchor.href : "";

      if (name && link) {
        results.push({ name, address, price, link });
      }
    });

    return results;
  });

  console.log(`Found ${listings.length} apartments:\n`);

  for (const apt of listings) {
    console.log(`${apt.name}`);
    console.log(`  Address: ${apt.address}`);
    console.log(`  Price: ${apt.price}`);
    console.log(`  Link: ${apt.link}`);
    console.log();
  }

  await stagehand.close();

  return listings;
}

// Run the scraper
const city = process.argv[2] || "san-francisco-ca";
const bedrooms = parseInt(process.argv[3] || "2", 10);

scrapeApartments(city, bedrooms)
  .then((listings) => {
    console.log("\n--- JSON Output ---");
    console.log(JSON.stringify(listings, null, 2));
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
