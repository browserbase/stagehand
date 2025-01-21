import { StagehandContainer } from "./StagehandContainer";

export class ElementContainer implements StagehandContainer {
  constructor(private el: HTMLElement) {}

  public getViewportHeight(): number {
    return this.el.clientHeight;
  }

  public getScrollHeight(): number {
    return this.el.scrollHeight;
  }

  public async scrollTo(offset: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    this.el.scrollTo({ top: offset, left: 0, behavior: "smooth" });
    await this.waitForScrollEnd();
  }

  private async waitForScrollEnd(): Promise<void> {
    return new Promise<void>((resolve) => {
      let scrollEndTimer: number;
      const handleScroll = () => {
        clearTimeout(scrollEndTimer);
        scrollEndTimer = window.setTimeout(() => {
          this.el.removeEventListener("scroll", handleScroll);
          resolve();
        }, 100);
      };
      this.el.addEventListener("scroll", handleScroll, { passive: true });
      handleScroll();
    });
  }
}
