import type { Locator } from "../../understudy/locator.js";

export type ScreenshotAnimationsOption = "disabled" | "allow";
export type ScreenshotCaretOption = "hide" | "initial";
export type ScreenshotScaleOption = "css" | "device";

export interface ScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotOptions {
  animations?: ScreenshotAnimationsOption;
  caret?: ScreenshotCaretOption;
  clip?: ScreenshotClip;
  fullPage?: boolean;
  mask?: Locator[];
  maskColor?: string;
  omitBackground?: boolean;
  path?: string;
  quality?: number;
  scale?: ScreenshotScaleOption;
  style?: string;
  timeout?: number;
  type?: "png" | "jpeg";
}
