// We can use this enum to list the actions supported in performUnderstudyMethod
export enum SupportedUnderstudyAction {
  CLICK = "click",
  FILL = "fill",
  TYPE = "type",
  PRESS = "press",
  SCROLL = "scrollTo",
  NEXT_CHUNK = "nextChunk",
  PREV_CHUNK = "prevChunk",
  SELECT_OPTION_FROM_DROPDOWN = "selectOptionFromDropdown",
  HOVER = "hover",
  DOUBLE_CLICK = "doubleClick",
  DRAG_AND_DROP = "dragAndDrop",
}
