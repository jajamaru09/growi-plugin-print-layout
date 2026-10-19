import { describe, expect, test } from 'vitest';
import type { HeadingInfo } from '../layout';
import type { MeasuredBlock } from '../pagination';
import type { CapturedContent } from '../capture';
import { hiddenFitIndexes, paginateVisible } from './paginate-visible';

const H = 1000;
const block = (index: number, heightPx = 100): MeasuredBlock => ({ index, kind: 'other', heightPx });
const blocks = [0, 1, 2, 3, 4, 5].map((i) => block(i));
const heading = (blockIndex: number, level: number): HeadingInfo => ({
  blockIndex,
  level,
  label: `h${blockIndex}`,
  anchor: { tag: `h${level}`, textHash: String(blockIndex), parents: [], occurrence: 0 },
});
const headings = [heading(2, 2), heading(4, 2)];
const indices = (r: ReturnType<typeof paginateVisible>) => r.pages.map((p) => p.placements.map((pl) => pl.blockIndex));

describe('paginateVisible', () => {
  test('hidden blocks get no placement and the next block continues the page', () => {
    const r = paginateVisible(blocks, headings, new Set([2]), H, new Set());
    expect(indices(r)).toEqual([[0, 1, 4, 5]]);
    expect(r.hidden.ranges).toEqual([{ start: 2, end: 4, headingBlockIndex: 2 }]);
    expect(r.hidden.outermost).toEqual(r.hidden.ranges);
    expect([...r.hidden.blocks]).toEqual([2, 3]);
    expect(r.isEmpty).toBe(false);
  });

  test('a manual break on the first block after a hidden range starts a new page', () => {
    const r = paginateVisible(blocks, headings, new Set([2]), H, new Set([4]));
    expect(indices(r)).toEqual([[0, 1], [4, 5]]);
  });

  test('a manual break on a hidden block does nothing', () => {
    const r = paginateVisible(blocks, headings, new Set([2]), H, new Set([2]));
    expect(indices(r)).toEqual([[0, 1, 4, 5]]);
  });

  test('a range that starts at block 0 leaves no empty first page', () => {
    const r = paginateVisible(blocks, [heading(0, 1), heading(3, 1)], new Set([0]), H, new Set([0, 3]));
    expect(indices(r)).toEqual([[3, 4, 5]]);
    expect(r.isEmpty).toBe(false);
  });

  test('hiding everything yields exactly one placement-less page and isEmpty', () => {
    const r = paginateVisible(blocks, [heading(0, 1)], new Set([0]), H, new Set());
    expect(r.pages).toEqual([{ placements: [] }]);
    expect(r.isEmpty).toBe(true);
  });
});

describe('hiddenFitIndexes', () => {
  test('a fit target is hidden when it is, or sits inside, a hidden block', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h2>A</h2><table></table><h2>B</h2><ul><li><pre></pre></li></ul><table></table>';
    const blocks = Array.from(root.children) as HTMLElement[];
    const [table1, pre, table2] = Array.from(root.querySelectorAll<HTMLElement>('table, pre'));
    const content: CapturedContent = {
      root,
      blocks,
      images: [],
      columns: [],
      fits: [
        { element: table1, kind: 'table' },
        { element: pre, kind: 'code' },
        { element: table2, kind: 'table' },
      ],
    };
    expect([...hiddenFitIndexes(content, new Set([0, 1, 3]))].sort()).toEqual([0, 1]);
    expect(hiddenFitIndexes(content, new Set()).size).toBe(0);
  });
});
