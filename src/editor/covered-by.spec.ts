import { describe, expect, test } from 'vitest';
import type { HeadingInfo } from '../layout';
import { computeCoveredBy } from './covered-by';

const heading = (blockIndex: number, level: number): HeadingInfo => ({
  blockIndex,
  level,
  label: `h${blockIndex}`,
  anchor: { tag: `H${level}`, textHash: String(blockIndex), parents: [], occurrence: 0 },
});

describe('computeCoveredBy', () => {
  const headings = [heading(0, 2), heading(2, 3), heading(4, 3), heading(6, 2)];

  test('headings inside a hidden range map to the outermost range heading', () => {
    const ranges = [
      { start: 0, end: 6, headingBlockIndex: 0 },
      { start: 2, end: 4, headingBlockIndex: 2 },
    ];
    const map = computeCoveredBy(headings, new Set([0, 2]), ranges);
    expect([...map]).toEqual([[4, 0]]);
  });

  test('a heading the user hid is not reported as covered', () => {
    const ranges = [{ start: 0, end: 6, headingBlockIndex: 0 }];
    expect(computeCoveredBy(headings, new Set([0, 2]), ranges).has(2)).toBe(false);
  });

  test('nothing is covered without ranges', () => {
    expect(computeCoveredBy(headings, new Set(), []).size).toBe(0);
  });
});
