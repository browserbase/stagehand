import { filterCharacters } from "../lib/utils";

// Test strings with problematic Unicode characters
const testStrings = {
  // "hello world" with language tag characters (U+E0001, U+E0020-U+E007F)
  // Note: JavaScript doesn't support 5-digit Unicode escapes directly, so we use surrogate pairs
  languageTag: "hello \u{E0001}w\u{E0020}o\u{E0030}r\u{E0040}l\u{E0050}d\u{E0060}",
  // Emoji with variation selectors (U+FE00-U+FE0F)
  emojiVariation: "hello 😊\uFE0F",
  // Text with supplementary variation selectors (U+E0100-U+E01EF)
  // These are represented as surrogate pairs in JavaScript
  supplementaryVariation: "hello \u{E0100}\u{E0120}\u{E0140}\u{E0160}\u{E0180}"
};

// Helper function to print code points
function printCodePoints(str: string): string {
  return Array.from(str).map(c => {
    const cp = c.codePointAt(0);
    return cp !== undefined ? cp.toString(16).padStart(4, '0') : '';
  }).join(', ');
}

// Test 1: Default filtering (all enabled)
console.log("=== Test 1: Default filtering (all enabled) ===");
for (const [key, value] of Object.entries(testStrings)) {
  console.log(`Original ${key}: "${value}" (length: ${value.length})`);
  console.log(`Original code points: ${printCodePoints(value)}`);
  const filtered = filterCharacters(value);
  console.log(`Filtered ${key}: "${filtered}" (length: ${filtered.length})`);
  console.log(`Filtered code points: ${printCodePoints(filtered)}`);
  console.log();
}

// Test 2: No filtering
console.log("\n=== Test 2: No filtering ===");
for (const [key, value] of Object.entries(testStrings)) {
  console.log(`Original ${key}: "${value}" (length: ${value.length})`);
  console.log(`Original code points: ${printCodePoints(value)}`);
  const filtered = filterCharacters(value, {
    blockLanguageTag: false,
    blockEmojiVariationBase: false,
    blockEmojiVariationModifier: false
  });
  console.log(`Filtered ${key}: "${filtered}" (length: ${filtered.length})`);
  console.log(`Filtered code points: ${printCodePoints(filtered)}`);
  console.log();
}

// Test 3: Selective filtering
console.log("\n=== Test 3: Selective filtering ===");
for (const [key, value] of Object.entries(testStrings)) {
  console.log(`Original ${key}: "${value}" (length: ${value.length})`);
  console.log(`Original code points: ${printCodePoints(value)}`);
  const filtered = filterCharacters(value, {
    blockLanguageTag: true,
    blockEmojiVariationBase: false,
    blockEmojiVariationModifier: true
  });
  console.log(`Filtered ${key}: "${filtered}" (length: ${filtered.length})`);
  console.log(`Filtered code points: ${printCodePoints(filtered)}`);
  console.log();
}

// Test 4: Combined string with all types of characters
const combinedString = `Combined test: ${testStrings.languageTag} | ${testStrings.emojiVariation} | ${testStrings.supplementaryVariation}`;
console.log("\n=== Test 4: Combined string ===");
console.log(`Original: "${combinedString}" (length: ${combinedString.length})`);
console.log(`Original code points: ${printCodePoints(combinedString)}`);

console.log("\nWith all filters:");
const filteredAll = filterCharacters(combinedString);
console.log(`Filtered: "${filteredAll}" (length: ${filteredAll.length})`);
console.log(`Filtered code points: ${printCodePoints(filteredAll)}`);

console.log("\nWith selective filters:");
const filteredSelective = filterCharacters(combinedString, {
  blockLanguageTag: true,
  blockEmojiVariationBase: false,
  blockEmojiVariationModifier: true
});
console.log(`Filtered: "${filteredSelective}" (length: ${filteredSelective.length})`);
console.log(`Filtered code points: ${printCodePoints(filteredSelective)}`); 