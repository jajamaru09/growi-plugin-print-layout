import { describe, expect, test } from 'vitest';
import { fnv1a32Hex } from './anchors';
import { computeHeadings, hiddenBlockSet, hiddenRanges, outermostRanges } from './headings';

const blocksOf = (html: string): Element[] => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return Array.from(root.children);
};

const hash = (text: string): string => fnv1a32Hex(text);

describe('computeHeadings', () => {
  const blocks = blocksOf('<h1>A</h1><p>x</p><h2>B</h2><h3>C</h3><h2>D</h2><h1>E</h1><h2>B</h2>');
  const headings = computeHeadings(blocks);

  test('lists the heading blocks with their block index and level', () => {
    expect(headings.map((h) => h.blockIndex)).toEqual([0, 2, 3, 4, 5, 6]);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 2, 1, 2]);
  });

  test('parents are the ancestor headings outermost first', () => {
    expect(headings[2].anchor).toEqual({ tag: 'h3', textHash: hash('C'), parents: [hash('A'), hash('B')], occurrence: 0 });
    expect(headings[3].anchor.parents).toEqual([hash('A')]);
    expect(headings[4].anchor.parents).toEqual([]);
  });

  test('two equal headings under different ancestors each have occurrence 0', () => {
    expect(headings[1].anchor).toEqual({ tag: 'h2', textHash: hash('B'), parents: [hash('A')], occurrence: 0 });
    expect(headings[5].anchor).toEqual({ tag: 'h2', textHash: hash('B'), parents: [hash('E')], occurrence: 0 });
  });

  test('equal headings under the same ancestors count occurrences', () => {
    const repeated = computeHeadings(blocksOf('<h1>A</h1><h2>S</h2><h2>S</h2>'));
    expect(repeated.map((h) => h.anchor.occurrence)).toEqual([0, 0, 1]);
  });

  test('a skipped level takes the nearest higher heading as parent', () => {
    const skipped = computeHeadings(blocksOf('<h1>A</h1><h3>C</h3>'));
    expect(skipped[1].anchor.parents).toEqual([hash('A')]);
  });

  test('the label is the normalized text cut to 100 characters', () => {
    const long = `  ${'あ'.repeat(75)}\n  ${'い'.repeat(75)}`;
    const [heading] = computeHeadings(blocksOf(`<h2>${long}</h2>`));
    expect(heading.label).toBe(`${'あ'.repeat(75)} ${'い'.repeat(24)}`);
    expect(heading.label.length).toBe(100);
    expect(headings[0].label).toBe('A');
  });

  test('headings nested inside another block are not headings', () => {
    expect(computeHeadings(blocksOf('<blockquote><h2>Q</h2></blockquote><ul><li><h3>L</h3></li></ul>'))).toEqual([]);
  });
});

describe('hiddenRanges', () => {
  const headings = computeHeadings(
    blocksOf('<h2>a</h2><p>1</p><h3>b</h3><p>3</p><h2>c</h2><p>5</p><h1>d</h1><p>7</p>'),
  );
  const ranges = (hidden: number[]) => hiddenRanges(headings, new Set(hidden), 8);

  test('a hidden heading hides up to the next heading of the same or a higher level', () => {
    expect(ranges([0])).toEqual([{ start: 0, end: 4, headingBlockIndex: 0 }]);
    expect(ranges([2])).toEqual([{ start: 2, end: 4, headingBlockIndex: 2 }]);
    expect(ranges([4])).toEqual([{ start: 4, end: 6, headingBlockIndex: 4 }]);
    expect(ranges([6])).toEqual([{ start: 6, end: 8, headingBlockIndex: 6 }]);
  });

  test('returns one range per hidden heading in block order', () => {
    expect(ranges([6, 0]).map((r) => r.headingBlockIndex)).toEqual([0, 6]);
  });

  test('a hidden index that is not a heading yields no range', () => {
    expect(ranges([1, 3])).toEqual([]);
  });
});

describe('outermostRanges and hiddenBlockSet', () => {
  const headings = computeHeadings(
    blocksOf('<h2>a</h2><p>1</p><h3>b</h3><p>3</p><h2>c</h2><p>5</p><h1>d</h1><p>7</p>'),
  );

  test('a range inside another is dropped', () => {
    const ranges = hiddenRanges(headings, new Set([0, 2]), 8);
    expect(outermostRanges(ranges)).toEqual([{ start: 0, end: 4, headingBlockIndex: 0 }]);
  });

  test('adjacent ranges are not nested and both stay', () => {
    const ranges = hiddenRanges(headings, new Set([0, 4]), 8);
    expect(outermostRanges(ranges)).toEqual([
      { start: 0, end: 4, headingBlockIndex: 0 },
      { start: 4, end: 6, headingBlockIndex: 4 },
    ]);
  });

  test('hiddenBlockSet is the union of the ranges', () => {
    const ranges = hiddenRanges(headings, new Set([0, 2, 6]), 8);
    expect([...hiddenBlockSet(ranges)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 6, 7]);
  });
});

describe('heading labels', () => {
  test('a heading without text gets a placeholder label', () => {
    const [heading] = computeHeadings(blocksOf('<h2><img src="/x.png"></h2>'));
    expect(heading.label).toBe('（見出しの文字なし）');
  });
});
