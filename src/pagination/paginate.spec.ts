import { describe, expect, test } from 'vitest';
import type { MeasuredBlock, Page, Placement } from './paginate';
import { paginate } from './paginate';

const H = 1000;
const none = new Set<number>();
const other = (index: number, heightPx: number): MeasuredBlock => ({ index, kind: 'other', heightPx });
const blockIndices = (pages: Page[]) => pages.map((p) => p.placements.map((pl) => pl.blockIndex));
const ranges = (pages: Page[], blockIndex: number) =>
  pages.flatMap((p) => p.placements.filter((pl) => pl.blockIndex === blockIndex).map((pl) => pl.unitRange));

describe('paginate: whole blocks', () => {
  test('three 400px blocks → pages [[0,1],[2]]', () => {
    const pages = paginate([other(0, 400), other(1, 400), other(2, 400)], H, none);
    expect(pages).toStrictEqual([
      { placements: [{ blockIndex: 0 }, { blockIndex: 1 }] },
      { placements: [{ blockIndex: 2 }] },
    ]);
  });

  test('forced break before block 1 → [[0],[1,2]] even though it fits', () => {
    const pages = paginate([other(0, 100), other(1, 100), other(2, 100)], H, new Set([1]));
    expect(blockIndices(pages)).toEqual([[0], [1, 2]]);
  });

  test('forced break on block 0 does not create an empty first page', () => {
    const pages = paginate([other(0, 100), other(1, 100)], H, new Set([0]));
    expect(blockIndices(pages)).toEqual([[0, 1]]);
  });

  test('forced break flushes a page holding only zero-height blocks', () => {
    const pages = paginate([other(0, 0), other(1, 0)], H, new Set([1]));
    expect(blockIndices(pages)).toEqual([[0], [1]]);
  });

  test('forced breaks and placements use block.index, not array position', () => {
    const pages = paginate([other(10, 100), other(11, 100)], H, new Set([11]));
    expect(blockIndices(pages)).toEqual([[10], [11]]);
  });

  test('a block filling the page exactly fits', () => {
    const pages = paginate([other(0, 600), other(1, 400), other(2, 1)], H, none);
    expect(blockIndices(pages)).toEqual([[0, 1], [2]]);
  });

  test('zero-height blocks are placed', () => {
    const pages = paginate([other(0, 1000), other(1, 0)], H, none);
    expect(blockIndices(pages)).toEqual([[0, 1]]);
  });

  test('negative and NaN block heights are treated as 0', () => {
    const pages = paginate([other(0, 1000), other(1, -50), other(2, Number.NaN)], H, none);
    expect(blockIndices(pages)).toEqual([[0, 1, 2]]);
  });

  test('a table that fits a page but not the remaining space moves whole (no split)', () => {
    const table: MeasuredBlock = {
      index: 1,
      kind: 'table',
      heightPx: 800,
      unitHeightsPx: Array(15).fill(50),
      headerHeightPx: 40,
      fixedHeightPx: 10,
    };
    expect(paginate([other(0, 400), table], H, none)).toStrictEqual([
      { placements: [{ blockIndex: 0 }] },
      { placements: [{ blockIndex: 1 }] },
    ]);
  });

  test('empty input → []', () => {
    expect(paginate([], H, none)).toEqual([]);
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('pageHeightPx %s throws', (h) => {
    expect(() => paginate([other(0, 10)], h, none)).toThrow();
  });
});

describe('paginate: oversized blocks', () => {
  test('1500px media block alone on its page with scale 2/3', () => {
    expect(paginate([{ index: 0, kind: 'media', heightPx: 1500 }], 1000, new Set())).toEqual([
      { placements: [{ blockIndex: 0, scale: 1000 / 1500 }] },
    ]);
  });

  test('a 1200px "other" block (long paragraph) is scaled, never split, and sits alone', () => {
    const pages = paginate([other(0, 100), other(1, 1200), other(2, 0), other(3, 100)], H, none);
    expect(pages).toStrictEqual([
      { placements: [{ blockIndex: 0 }] },
      { placements: [{ blockIndex: 1, scale: 1000 / 1200 }] },
      { placements: [{ blockIndex: 2 }, { blockIndex: 3 }] },
    ]);
  });

  test('an oversized container is split between its leaves like table rows, without a header', () => {
    const container: MeasuredBlock = {
      index: 0,
      kind: 'container',
      heightPx: 10 + 5 * 300,
      unitHeightsPx: Array(5).fill(300),
      fixedHeightPx: 10,
    };
    // 10 + 3 × 300 = 910 fits; a fourth leaf would not.
    expect(ranges(paginate([container], H, none), 0)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 5 },
    ]);
  });

  test('the 21-line container from the bug report flows over pages instead of being crushed', () => {
    // Measured on the real page: a .f2_container of 42 items wrapped into 21 two-column lines.
    const lines = [
      1074, 356, 1021, 1141, 701, 986, 440, 935, 1073, 377, 746, 329, 782, 538, 445, 343, 937, 374,
      398, 917, 550,
    ];
    const block: MeasuredBlock = {
      index: 0,
      kind: 'container',
      heightPx: 14463,
      unitHeightsPx: lines,
      fixedHeightPx: 0,
    };
    // A4 portrait with 15mm margins leaves 1009px of content; unsplit, the block scaled to 0.07.
    const pages = paginate([block], 1009, none);
    const scales = pages
      .flatMap((p) => p.placements)
      .map((p) => p.scale)
      .filter((s): s is number => s !== undefined);

    expect(pages).toHaveLength(19);
    // Only the four lines taller than a page are scaled, and barely.
    expect(scales).toHaveLength(4);
    expect(Math.min(...scales)).toBeGreaterThan(0.85);
  });

  test('an oversized table without unit heights is scaled alone like "other"', () => {
    const pages = paginate([{ index: 0, kind: 'table', heightPx: 2000, unitHeightsPx: [] }], H, none);
    expect(pages).toStrictEqual([{ placements: [{ blockIndex: 0, scale: 0.5 }] }]);
  });

  test('table of 30 rows × 50px, header 40, fixed 10: second fragment repeats header and ranges cover all rows exactly once', () => {
    const table: MeasuredBlock = {
      index: 0,
      kind: 'table',
      heightPx: 10 + 40 + 30 * 50,
      unitHeightsPx: Array(30).fill(50),
      headerHeightPx: 40,
      fixedHeightPx: 10,
    };
    const pages = paginate([table], H, none);
    // Each fragment: 10 + 40 + rows; 950 / 50 = 19 rows on page 1, the remaining 11 on page 2.
    expect(pages).toHaveLength(2);
    expect(ranges(pages, 0)).toEqual([
      { start: 0, end: 19 },
      { start: 19, end: 30 },
    ]);
  });

  test('a large table starting mid-page begins on the current page', () => {
    const table: MeasuredBlock = {
      index: 1,
      kind: 'table',
      heightPx: 10 + 40 + 25 * 50,
      unitHeightsPx: Array(25).fill(50),
      headerHeightPx: 40,
      fixedHeightPx: 10,
    };
    const pages = paginate([other(0, 400), table, other(2, 100)], H, none);
    // 1000 - 400 - 50 = 550 → 11 rows on page 1; 14 rows (750px) on page 2, leaving room for block 2.
    expect(pages).toStrictEqual([
      { placements: [{ blockIndex: 0 }, { blockIndex: 1, unitRange: { start: 0, end: 11 } }] },
      { placements: [{ blockIndex: 1, unitRange: { start: 11, end: 25 } }, { blockIndex: 2 }] },
    ]);
  });

  test('a large table starts on a new page when not even one row fits the remaining space', () => {
    const table: MeasuredBlock = {
      index: 1,
      kind: 'table',
      heightPx: 1500,
      unitHeightsPx: Array(30).fill(50),
      headerHeightPx: 40,
      fixedHeightPx: 10,
    };
    const pages = paginate([other(0, 920), table], H, none);
    expect(blockIndices(pages)[0]).toEqual([0]);
    expect(ranges(pages, 1)[0]).toEqual({ start: 0, end: 19 });
  });

  test('code block of 120 lines × 20px with fixed 16 splits into contiguous ranges', () => {
    const code: MeasuredBlock = {
      index: 0,
      kind: 'code',
      heightPx: 16 + 120 * 20,
      unitHeightsPx: Array(120).fill(20),
      headerHeightPx: 999, // ignored for code
      fixedHeightPx: 16,
    };
    // (1000 - 16) / 20 = 49.2 → 49 lines per page.
    expect(ranges(paginate([code], H, none), 0)).toEqual([
      { start: 0, end: 49 },
      { start: 49, end: 98 },
      { start: 98, end: 120 },
    ]);
  });

  test('a single table row taller than a page becomes its own fragment with scale', () => {
    const table: MeasuredBlock = {
      index: 0,
      kind: 'table',
      heightPx: 10 + 40 + 1400,
      unitHeightsPx: [100, 1200, 100],
      headerHeightPx: 40,
      fixedHeightPx: 10,
    };
    expect(paginate([table], H, none)).toStrictEqual([
      { placements: [{ blockIndex: 0, unitRange: { start: 0, end: 1 } }] },
      { placements: [{ blockIndex: 0, unitRange: { start: 1, end: 2 }, scale: 1000 / 1250 }] },
      { placements: [{ blockIndex: 0, unitRange: { start: 2, end: 3 } }] },
    ]);
  });
});

// --- property-style check -------------------------------------------------

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randomHeight = (rnd: () => number, max: number): number => {
  const r = rnd();
  if (r < 0.05) return 0;
  if (r < 0.08) return Number.NaN;
  if (r < 0.1) return -10;
  return Math.round(rnd() * max);
};

const randomBlocks = (rnd: () => number): MeasuredBlock[] => {
  const count = Math.floor(rnd() * 12);
  const kinds = ['table', 'code', 'media', 'other'] as const;
  return Array.from({ length: count }, (_, i) => {
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const index = i + 7;
    if (kind === 'media' || kind === 'other') return { index, kind, heightPx: randomHeight(rnd, 1800) };
    const units = Array.from({ length: Math.floor(rnd() * 60) }, () => randomHeight(rnd, rnd() < 0.05 ? 1500 : 80));
    const fixedHeightPx = rnd() < 0.03 ? 1200 : randomHeight(rnd, 30);
    const headerHeightPx = randomHeight(rnd, 60);
    const heightPx = rnd() < 0.1 ? randomHeight(rnd, 3000) : units.reduce((s, u) => s + (u > 0 ? u : 0), 0) + 50;
    return { index, kind, heightPx, unitHeightsPx: units, fixedHeightPx, headerHeightPx };
  });
};

const pos = (x: number | undefined): number => (x !== undefined && Number.isFinite(x) && x > 0 ? x : 0);

const placementHeight = (block: MeasuredBlock, pl: Placement): number => {
  if (pl.unitRange === undefined) return pos(block.heightPx);
  const chrome = pos(block.fixedHeightPx) + (block.kind === 'table' ? pos(block.headerHeightPx) : 0);
  const units = (block.unitHeightsPx ?? []).slice(pl.unitRange.start, pl.unitRange.end);
  return units.reduce((s, u) => s + pos(u), chrome);
};

describe('paginate: invariants on random inputs', () => {
  test.each(Array.from({ length: 300 }, (_, i) => i + 1))('seed %i', (seed) => {
    const rnd = mulberry32(seed);
    const blocks = randomBlocks(rnd);
    const forced = new Set(blocks.filter(() => rnd() < 0.15).map((b) => b.index));
    const pages = paginate(blocks, H, forced);
    const byIndex = new Map(blocks.map((b) => [b.index, b]));

    // No empty pages.
    for (const page of pages) expect(page.placements.length).toBeGreaterThan(0);

    // Blocks appear in order.
    const flat = pages.flatMap((p) => p.placements);
    const order = flat.map((pl) => pl.blockIndex);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    for (const block of blocks) {
      const own = flat.filter((pl) => pl.blockIndex === block.index);
      if (own.length === 1 && own[0].unitRange === undefined) continue;
      // Split: contiguous ranges covering every unit exactly once.
      const n = block.unitHeightsPx?.length ?? 0;
      let next = 0;
      for (const pl of own) {
        expect(pl.unitRange).toBeDefined();
        expect(pl.unitRange?.start).toBe(next);
        expect(pl.unitRange?.end).toBeGreaterThan(next);
        next = pl.unitRange?.end ?? next;
      }
      expect(next).toBe(n);
    }

    for (const page of pages) {
      const scaled = page.placements.filter((pl) => pl.scale !== undefined);
      if (scaled.length > 0) {
        // A scaled placement sits alone on its page.
        expect(page.placements).toHaveLength(1);
        expect(scaled[0].scale).toBeGreaterThan(0);
        expect(scaled[0].scale).toBeLessThan(1);
        continue;
      }
      const fill = page.placements.reduce((s, pl) => s + placementHeight(byIndex.get(pl.blockIndex)!, pl), 0);
      expect(fill).toBeLessThanOrEqual(H);
    }

    // Forced blocks begin a page.
    for (const index of forced) {
      const pageOfFirst = pages.find((p) => p.placements.some((pl) => pl.blockIndex === index));
      expect(pageOfFirst?.placements[0].blockIndex).toBe(index);
    }
  });
});
