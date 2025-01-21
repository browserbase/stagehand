export interface StagehandContainer {
  getViewportHeight(): number;

  getScrollHeight(): number;

  scrollTo(offset: number): Promise<void>;
}
