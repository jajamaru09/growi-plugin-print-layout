import { describe, expect, test } from 'vitest';
import { bandsOf, fixedHeight, lineStartOffsets, locateTextOffset, spansBetween } from './measure-math';

describe('spansBetween', () => {
  test('each span runs from its start to the next start, the last to the end', () => {
    expect(spansBetween([0, 30, 50], 120)).toEqual([30, 20, 70]);
  });

  test('a missing start (unrendered element) gets a zero span', () => {
    expect(spansBetween([0, null, 50], 80)).toEqual([50, 0, 30]);
  });

  test('a start that goes backwards is clamped to zero instead of a negative span', () => {
    expect(spansBetween([10, 5, 40], 60)).toEqual([0, 35, 20]);
  });

  test('no starts yields no spans', () => {
    expect(spansBetween([], 100)).toEqual([]);
  });
});

describe('fixedHeight', () => {
  test('is the total minus header and units', () => {
    expect(fixedHeight(200, 30, [50, 50, 40])).toBe(30);
  });

  test('never goes negative', () => {
    expect(fixedHeight(100, 30, [50, 50])).toBe(0);
  });
});

describe('lineStartOffsets', () => {
  test('returns the offset where each line starts', () => {
    expect(lineStartOffsets('ab\n\ncde')).toEqual([0, 3, 4]);
  });

  test('a single trailing newline does not create an extra line', () => {
    expect(lineStartOffsets('ab\ncd\n')).toEqual([0, 3]);
  });

  test('empty text has no lines', () => {
    expect(lineStartOffsets('')).toEqual([]);
  });
});

describe('locateTextOffset', () => {
  test('maps a global offset to the text segment holding it', () => {
    expect(locateTextOffset([3, 2, 4], 0)).toEqual({ segment: 0, offset: 0 });
    expect(locateTextOffset([3, 2, 4], 3)).toEqual({ segment: 1, offset: 0 });
    expect(locateTextOffset([3, 2, 4], 6)).toEqual({ segment: 2, offset: 1 });
  });

  test('skips empty segments', () => {
    expect(locateTextOffset([2, 0, 3], 2)).toEqual({ segment: 2, offset: 0 });
  });

  test('the end of the text maps to the end of the last segment', () => {
    expect(locateTextOffset([3, 2], 5)).toEqual({ segment: 1, offset: 2 });
  });
});

describe('bandsOf', () => {
  test('children that stack each form their own band', () => {
    expect(bandsOf([{ top: 0, bottom: 10 }, { top: 10, bottom: 30 }, { top: 30, bottom: 40 }])).toEqual([0, 1, 2]);
  });

  test('flex items sharing a line form one band', () => {
    expect(
      bandsOf([
        { top: 0, bottom: 100 },
        { top: 0, bottom: 100 },
        { top: 100, bottom: 150 },
        { top: 100, bottom: 150 },
      ]),
    ).toEqual([0, 0, 1, 1]);
  });

  test('a band stays open until an item clears the tallest one in it', () => {
    expect(bandsOf([{ top: 0, bottom: 100 }, { top: 20, bottom: 60 }, { top: 100, bottom: 120 }])).toEqual([0, 0, 1]);
  });

  test('an item without layout joins the band before it, and leads the first one', () => {
    expect(bandsOf([null, { top: 0, bottom: 10 }, { top: 10, bottom: 20 }, null])).toEqual([0, 0, 1, 1]);
  });

  test('no items, no bands', () => {
    expect(bandsOf([])).toEqual([]);
  });
});
