export default class Browserbase {
  public async createSession() {
    const response = await fetch(`https://www.browserbase.com/v1/sessions`, {
      method: "POST",
      headers: {
        "x-bb-api-key": `${process.env.BROWSERBASE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: process.env.BROWSERBASE_PROJECT_ID ?? undefined,
      }),
    });

    const json = await response.json();
    if (json.error) {
      throw new Error(json.error);
    }

    return {
      sessionId: json.id,
    };
  }

  public async retrieveDebugConnectionURL(sessionId: string) {
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
