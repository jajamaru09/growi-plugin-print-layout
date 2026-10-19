import type { HeadingInfo, HiddenRange } from '../layout';

/** Maps each heading hidden only by an enclosing hidden heading to that outermost heading's block index. */
export function computeCoveredBy(
  headings: readonly HeadingInfo[],
  hidden: ReadonlySet<number>,
  ranges: readonly HiddenRange[],
): Map<number, number> {
  const covered = new Map<number, number>();
  for (const heading of headings) {
    if (hidden.has(heading.blockIndex)) continue;
    const outer = ranges.find((r) => r.start < heading.blockIndex && heading.blockIndex < r.end);
    if (outer != null) covered.set(heading.blockIndex, outer.headingBlockIndex);
  }
  return covered;
}
