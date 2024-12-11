export class SlackHandler {
  private readonly webhookUrl: string | undefined;
  private readonly enabled: boolean;

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl;
    this.enabled = !!webhookUrl;
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await fetch(this.webhookUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
      });
    } catch (error) {
      console.error("Failed to send Slack message:", error);
    }
  }
}
