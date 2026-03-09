export async function duckDuckGoSearch(
  query: string,
  maxResults = 5,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: {
      "user-agent": "stagehand-agent/0.0",
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: ${response.status}`);
  }

  const html = await response.text();
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const blocks = html.split('<div class="result results_links').slice(1);

  for (const block of blocks) {
    if (results.length >= maxResults) {
      break;
    }

    const title = match(block, /result__a[^>]*>(.*?)<\/a>/is);
    const url = match(block, /result__a[^>]*href="([^"]+)"/i);
    const snippet = match(block, /result__snippet[^>]*>(.*?)<\/a>|result__snippet[^>]*>(.*?)<\/div>/is);

    if (!title || !url) {
      continue;
    }

    results.push({
      title: decodeHtml(stripTags(title)),
      url: decodeHtml(url),
      snippet: decodeHtml(stripTags(snippet ?? "")),
    });
  }

  return results;
}

function match(input: string, pattern: RegExp): string | null {
  const result = pattern.exec(input);
  if (!result) {
    return null;
  }
  return result[1] ?? result[2] ?? null;
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
