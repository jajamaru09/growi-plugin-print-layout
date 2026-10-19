/**
 * Calls `visit` with every element of `source` (itself included) and its counterpart in `clone`,
 * which must be an unmodified deep clone of `source`: both are walked in lockstep.
 */
export function forEachCounterpart(
  source: Element,
  clone: Element,
  visit: (sourceEl: Element, cloneEl: Element) => void,
): void {
  const clones = [clone, ...Array.from(clone.querySelectorAll('*'))];
  [source, ...Array.from(source.querySelectorAll('*'))].forEach((el, i) => {
    const counterpart = clones[i];
    if (counterpart !== undefined) visit(el, counterpart);
  });
}
