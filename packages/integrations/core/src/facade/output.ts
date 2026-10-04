export function transportSafeText(text: string): string {
  return text.replace(
    /[\u0085\u2028\u2029]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
