import { StagehandContainer } from "./StagehandContainer";
import { calculateViewportHeight } from "./utils";

export class GlobalPageContainer implements StagehandContainer {
  public getViewportHeight(): number {
    return calculateViewportHeight();
  }

  public getScrollHeight(): number {
    return document.documentElement.scrollHeight;
  }

  public async scrollTo(offset: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    window.scrollTo({ top: offset, left: 0, behavior: "smooth" });
    await this.waitForScrollEnd();
  }

  private async waitForScrollEnd(): Promise<void> {
    return new Promise<void>((resolve) => {
      let scrollEndTimer: number;
      const handleScroll = () => {
        clearTimeout(scrollEndTimer);
        scrollEndTimer = window.setTimeout(() => {
          window.removeEventListener("scroll", handleScroll);
          resolve();
        }, 100);
      };
      window.addEventListener("scroll", handleScroll, { passive: true });
      handleScroll();
    });
  }
}
