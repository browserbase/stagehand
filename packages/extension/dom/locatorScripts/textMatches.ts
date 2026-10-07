export function filterInnermostMatches<T extends { element: Element }>(matches: T[]): T[] {
  const matchingElements = new Set(matches.map(({ element }) => element));
  const matchingAncestors = new Set<Element>();
  const visited = new Set<Element>();
  for (const { element } of matches) {
    let parent = element.parentElement;
    // parentElement stops at a shadow root, matching Element.contains semantics.
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      if (matchingElements.has(parent)) matchingAncestors.add(parent);
      parent = parent.parentElement;
    }
  }
  return matches.filter(({ element }) => !matchingAncestors.has(element));
}
