export default class Browserbase {
  public async createSession() {
    if (
      !process.env.BROWSERBASE_API_KEY ||
      !process.env.BROWSERBASE_PROJECT_ID
    ) {
      throw new Error(
        "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set",
      );
    }
    const response = await fetch(`https://www.browserbase.com/v1/sessions`, {
      method: "POST",
      headers: {
        "x-bb-api-key": `${process.env.BROWSERBASE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: process.env.BROWSERBASE_PROJECT_ID,
      }),
    });

    const json = await response.json();
    if (json.error) {
      throw new Error(json.error);
    }

    return {
      sessionId: json.id,
      connectUrl: json.connectUrl,
    };
  }

  public async retrieveDebugConnectionURL(sessionId: string) {
    if (!process.env.BROWSERBASE_API_KEY) {
      throw new Error("BROWSERBASE_API_KEY must be set");
    }
    const response = await fetch(
      `https://www.browserbase.com/v1/sessions/${sessionId}/debug`,
      {
        method: "GET",
        headers: {
          "x-bb-api-key": `${process.env.BROWSERBASE_API_KEY}`,
        },
      },
    );
    const json = await response.json();
    return json.debuggerFullscreenUrl;
  }
}
