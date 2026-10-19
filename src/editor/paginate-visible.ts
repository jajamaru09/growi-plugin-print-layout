import { type HeadingInfo, type HiddenRange, hiddenBlockSet, hiddenRanges, outermostRanges } from '../layout';
import type { CapturedContent } from '../capture';
import { type MeasuredBlock, type Page, paginate } from '../pagination';

export interface HiddenLayout {
  ranges: HiddenRange[];
  outermost: HiddenRange[];
  blocks: ReadonlySet<number>;
}

export interface VisibleLayout {
  pages: Page[];
  hidden: HiddenLayout;
  isEmpty: boolean;
}

/**
 * Paginates only the blocks outside hidden ranges. `blocks` is every measured block, so un-hiding needs no
 * re-measure. Breaks on hidden blocks never reach `paginate`'s lookup and are simply ignored.
 */
export function paginateVisible(
  blocks: readonly MeasuredBlock[],
  headings: readonly HeadingInfo[],
  hiddenHeadings: ReadonlySet<number>,
  pageHeightPx: number,
  breaks: ReadonlySet<number>,
): VisibleLayout {
  const ranges = hiddenRanges(headings, hiddenHeadings, blocks.length);
  const hiddenBlocks = hiddenBlockSet(ranges);
  const pages = paginate(
    blocks.filter((b) => !hiddenBlocks.has(b.index)),
    pageHeightPx,
    breaks,
  );
  const hidden = { ranges, outermost: outermostRanges(ranges), blocks: hiddenBlocks };
  // An empty preview still shows one blank page so the user sees where the content went.
  return pages.length === 0
    ? { pages: [{ placements: [] }], hidden, isEmpty: true }
    : { pages, hidden, isEmpty: false };
}

/** Indexes of the fit targets that are, or sit inside, a hidden block. */
export function hiddenFitIndexes(content: CapturedContent, hiddenBlocks: ReadonlySet<number>): Set<number> {
  const hiddenEls = content.blocks.filter((_, i) => hiddenBlocks.has(i));
  return new Set(
    content.fits.flatMap((fit, i) => (hiddenEls.some((block) => block.contains(fit.element)) ? [i] : [])),
  );
}
