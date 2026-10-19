import type { CapturedContent } from '../capture';
import { classifyBlock, splitLeaves } from '../capture';
import { LEAF_ATTR, SPLIT_ATTR } from '../dom-attributes';
import { contentInsets } from './box';
import { bandsOf, fixedHeight, lineStartOffsets, locateTextOffset, spansBetween } from './measure-math';
import { withLaidOutClones } from './offscreen';
import type { MeasuredBlock } from './paginate';

const topOrNull = (el: Element): number | null =>
  el.getClientRects().length === 0 ? null : el.getBoundingClientRect().top;

/** Top/bottom of the content box: with `display: flow-root` it encloses every child margin. */
const contentEdges = (el: HTMLElement): { top: number; bottom: number } => {
  const rect = el.getBoundingClientRect();
  const insets = contentInsets(el);
  return { top: rect.top + insets.top, bottom: rect.bottom - insets.bottom };
};

const measureTable = (block: HTMLElement, totalPx: number): Partial<MeasuredBlock> => {
  const table = block.tagName === 'TABLE' ? block : block.querySelector('table');
  if (table == null) return {};
  const thead = table.querySelector(':scope > thead');
  const headerHeightPx = thead ? thead.getBoundingClientRect().height : 0;
  const rows = Array.from(table.querySelectorAll(':scope > tbody > tr'));
  const unitHeightsPx =
    rows.length === 0
      ? []
      : spansBetween(rows.map(topOrNull), rows[rows.length - 1].getBoundingClientRect().bottom);
  return { unitHeightsPx, headerHeightPx, fixedHeightPx: fixedHeight(totalPx, headerHeightPx, unitHeightsPx) };
};

/** Line extents measured with Ranges, so wrapped lines count as one unit. */
const measureCodeLines = (code: Element): number[] => {
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n != null; n = walker.nextNode()) nodes.push(n as Text);
  const lengths = nodes.map((n) => n.data.length);
  const text = nodes.map((n) => n.data).join('');
  const starts = lineStartOffsets(text);
  if (starts.length === 0) return [];

  const rectOf = (from: number, to: number): DOMRect => {
    const range = document.createRange();
    const a = locateTextOffset(lengths, from);
    const b = locateTextOffset(lengths, to);
    range.setStart(nodes[a.segment], a.offset);
    range.setEnd(nodes[b.segment], b.offset);
    return range.getBoundingClientRect();
  };
  const tops = starts.map((s) => rectOf(s, s + 1).top);
  const lastStart = starts[starts.length - 1];
  const bodyEnd = text.endsWith('\n') ? text.length - 1 : text.length;
  const end = rectOf(lastStart, Math.max(bodyEnd, lastStart + 1)).bottom;
  return spansBetween(tops, end);
};

const measureCode = (block: HTMLElement, totalPx: number): Partial<MeasuredBlock> => {
  const pre = block.tagName === 'PRE' ? block : block.querySelector('pre');
  if (pre == null) return {};
  // The filename label (`cite`) sits inside the pre but outside code; it ends up in the fixed part.
  const unitHeightsPx = measureCodeLines(pre.querySelector('code') ?? pre);
  return { unitHeightsPx, fixedHeightPx: fixedHeight(totalPx, 0, unitHeightsPx) };
};

const extentOrNull = (el: Element): { top: number; bottom: number } | null => {
  if (el.getClientRects().length === 0) return null;
  const { top, bottom } = el.getBoundingClientRect();
  return { top, bottom };
};

/** The top of each band: the highest of its leaves, so a line is measured from whichever cell starts first. */
const bandTops = (bands: readonly number[], extents: readonly ({ top: number } | null)[]): (number | null)[] =>
  bands.reduce<(number | null)[]>((tops, band, i) => {
    const top = extents[i]?.top ?? null;
    if (tops.length === band) tops.push(top);
    else if (top != null) tops[band] = Math.min(tops[band] ?? top, top);
    return tops;
  }, []);

/**
 * The units are the wrapper's vertical bands: one per child where they stack, one per line where
 * they wrap, so a cut never halves a two-column row. Each band runs from its top to the next
 * band's, so the gaps (collapsed margins, row gap, nested padding) go with the band above. The
 * grouping is recorded on `captured` as well, because renderPages rebuilds fragments without layout.
 */
const measureContainer = (
  block: HTMLElement,
  captured: HTMLElement,
  totalPx: number,
): Partial<MeasuredBlock> => {
  const leaves = splitLeaves(block);
  if (leaves.length === 0) return {};
  const extents = leaves.map(extentOrNull);
  const bands = bandsOf(extents);
  const capturedLeaves = splitLeaves(captured);
  leaves.forEach((leaf, i) => {
    leaf.setAttribute(LEAF_ATTR, String(bands[i]));
    capturedLeaves[i]?.setAttribute(LEAF_ATTR, String(bands[i]));
  });
  const unitHeightsPx = spansBetween(bandTops(bands, extents), contentEdges(block).bottom);
  // A fragment cut inside a nested wrapper prints that wrapper's top and bottom border and padding again;
  // reserving them for every nested wrapper keeps each fragment within its page.
  const nestedInsetsPx = Array.from(block.querySelectorAll(`[${SPLIT_ATTR}]`)).reduce((sum, el) => {
    const insets = contentInsets(el);
    return sum + insets.top + insets.bottom;
  }, 0);
  return { unitHeightsPx, fixedHeightPx: fixedHeight(totalPx, 0, unitHeightsPx) + nestedInsetsPx };
};

const measureLaidOut = (wiki: HTMLElement, content: CapturedContent, clones: HTMLElement[]): MeasuredBlock[] => {
  const edges = contentEdges(wiki);
  const starts = clones.map((c, i) => (i === 0 ? edges.top : topOrNull(c)));
  const heights = spansBetween(starts, edges.bottom);
  return clones.map((clone, index) => {
    const kind = classifyBlock(content.blocks[index]);
    const heightPx = heights[index];
    const details =
      kind === 'table'
        ? measureTable(clone, heightPx)
        : kind === 'code'
          ? measureCode(clone, heightPx)
          : kind === 'container'
            ? measureContainer(clone, content.blocks[index], heightPx)
            : {};
    return { index, kind, heightPx, ...details };
  });
};

/**
 * Lays copies of the blocks out off-screen at the printable width and measures
 * them. `content` itself is not touched.
 */
export async function measureBlocks(content: CapturedContent, contentWidthPx: number): Promise<MeasuredBlock[]> {
  return withLaidOutClones(content, contentWidthPx, (wiki, clones) => measureLaidOut(wiki, content, clones));
}
