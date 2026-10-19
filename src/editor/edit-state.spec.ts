import { describe, expect, test } from 'vitest';
import type { BlockAnchor, HeadingInfo, ImageAnchor, LayoutSettings } from '../layout';
import { computeBlockAnchors, computeHeadings, defaultLayout } from '../layout';
import {
  addBreak,
  type ContentAnchors,
  type EditState,
  moveBreak,
  removeBreak,
  removeUnmatched,
  resetColumnRatio,
  resetFitOverride,
  resetImageWidth,
  resetToAuto,
  restoreState,
  setColumnRatio,
  setFitOverride,
  setHidden,
  setImageWidth,
  toLayout,
} from './edit-state';

const blockAnchors: BlockAnchor[] = [
  { tag: 'h1', textHash: '00000001', occurrence: 0 },
  { tag: 'p', textHash: '00000002', occurrence: 0 },
  { tag: 'p', textHash: '00000002', occurrence: 1 },
  { tag: 'h2', textHash: '00000003', occurrence: 0 },
];
const imageAnchors: ImageAnchor[] = [
  { kind: 'img', key: '/a.png', occurrence: 0 },
  { kind: 'drawio', key: 'abcd1234', occurrence: 0 },
];

const columnAnchors: BlockAnchor[] = [
  { tag: 'div', textHash: '0000aaaa', occurrence: 0 },
  { tag: 'div', textHash: '0000aaaa', occurrence: 1 },
];

const fitAnchors: BlockAnchor[] = [
  { tag: 'table', textHash: '0000bbbb', occurrence: 0 },
  { tag: 'pre', textHash: '0000cccc', occurrence: 0 },
];

const headings: HeadingInfo[] = [
  { blockIndex: 0, level: 1, label: '第1部', anchor: { tag: 'h1', textHash: '00000001', parents: [], occurrence: 0 } },
  { blockIndex: 3, level: 2, label: '概要', anchor: { tag: 'h2', textHash: '00000003', parents: ['00000001'], occurrence: 0 } },
];

const anchors: ContentAnchors = { blocks: blockAnchors, images: imageAnchors, columns: columnAnchors, fits: fitAnchors, headings };

const headingIndexes = new Set(headings.map((h) => h.blockIndex));

const base = (): EditState => restoreState(null, anchors);

const saved = (over: Partial<LayoutSettings>): LayoutSettings => ({ ...defaultLayout('p', 'r'), ...over });

describe('restoreState', () => {
  test('without a saved layout it starts from the defaults', () => {
    expect(base()).toEqual({
      setup: defaultLayout('', '').page,
      breaks: [],
      imageWidths: {},
      columnRatios: {},
      fitOverrides: {},
      hidden: [],
      unmatched: { breaks: [], images: [], columns: [], fits: [], hidden: [] },
    });
  });

  test('matched entries become block / image indexes and the rest stays unmatched', () => {
    const orphanBreak = { anchor: { tag: 'h3', textHash: '0000ffff', occurrence: 0 } };
    const orphanImage = { anchor: { kind: 'img' as const, key: '/gone.png', occurrence: 0 }, widthPercent: 30 };
    const state = restoreState(
      saved({
        page: { ...defaultLayout('', '').page, orientation: 'landscape' },
        breaks: [{ anchor: blockAnchors[3] }, orphanBreak, { anchor: blockAnchors[2] }],
        images: [{ anchor: imageAnchors[1], widthPercent: 60 }, orphanImage],
      }),
      anchors,
    );
    expect(state.setup.orientation).toBe('landscape');
    expect(state.breaks).toEqual([2, 3]);
    expect(state.imageWidths).toEqual({ 1: 60 });
    expect(state.unmatched).toEqual({ breaks: [orphanBreak], images: [orphanImage], columns: [], fits: [], hidden: [] });
  });

  test('a saved break that lands on the first block cannot apply and is listed as unmatched', () => {
    const state = restoreState(saved({ breaks: [{ anchor: blockAnchors[0] }] }), anchors);
    expect(state.breaks).toEqual([]);
    expect(state.unmatched.breaks).toEqual([{ anchor: blockAnchors[0] }]);
  });

  test('a saved column ratio applies to the column whose anchor matches; an edited column stays unmatched', () => {
    const edited = { anchor: { tag: 'div', textHash: '0000bbbb', occurrence: 0 }, leftPercent: 40 };
    const state = restoreState(
      saved({ columns: [{ anchor: columnAnchors[1], leftPercent: 30 }, edited] }),
      anchors,
    );
    expect(state.columnRatios).toEqual({ 1: 30 });
    expect(state.unmatched.columns).toEqual([edited]);
  });
});

describe('break helpers', () => {
  test('addBreak keeps the list sorted and unique, and refuses block 0 or out of range', () => {
    let s = addBreak(base(), 3, blockAnchors.length);
    s = addBreak(s, 1, blockAnchors.length);
    s = addBreak(s, 3, blockAnchors.length);
    s = addBreak(s, 0, blockAnchors.length);
    s = addBreak(s, 9, blockAnchors.length);
    expect(s.breaks).toEqual([1, 3]);
  });

  test('moveBreak moves a break to another boundary', () => {
    const s = moveBreak(addBreak(base(), 1, 4), 1, 3, 4);
    expect(s.breaks).toEqual([3]);
  });

  test('moveBreak onto block 0 removes nothing and keeps the original', () => {
    const s = moveBreak(addBreak(base(), 1, 4), 1, 0, 4);
    expect(s.breaks).toEqual([1]);
  });

  test('removeBreak drops only that break', () => {
    const s = removeBreak(addBreak(addBreak(base(), 1, 4), 2, 4), 1);
    expect(s.breaks).toEqual([2]);
  });

  test('helpers do not mutate the input', () => {
    const before = addBreak(base(), 1, 4);
    const snapshot = structuredClone(before);
    addBreak(before, 2, 4);
    removeBreak(before, 1);
    setImageWidth(before, 0, 50);
    setColumnRatio(before, 0, 30);
    expect(before).toEqual(snapshot);
  });
});

describe('image width helpers', () => {
  test('setImageWidth clamps to 5..100 and rounds', () => {
    expect(setImageWidth(base(), 0, 150).imageWidths).toEqual({ 0: 100 });
    expect(setImageWidth(base(), 0, 1).imageWidths).toEqual({ 0: 5 });
    expect(setImageWidth(base(), 1, 42.6).imageWidths).toEqual({ 1: 43 });
  });

  test('setImageWidth ignores a non-finite width', () => {
    expect(setImageWidth(base(), 0, Number.NaN).imageWidths).toEqual({});
  });

  test('resetImageWidth removes the adjustment', () => {
    const s = resetImageWidth(setImageWidth(setImageWidth(base(), 0, 50), 1, 70), 0);
    expect(s.imageWidths).toEqual({ 1: 70 });
  });
});

describe('column ratio helpers', () => {
  test('setColumnRatio clamps to 10..90 and rounds to an integer', () => {
    expect(setColumnRatio(base(), 0, 95).columnRatios).toEqual({ 0: 90 });
    expect(setColumnRatio(base(), 0, 5).columnRatios).toEqual({ 0: 10 });
    expect(setColumnRatio(base(), 1, 32.6).columnRatios).toEqual({ 1: 33 });
  });

  test('setColumnRatio ignores a non-finite percent or a negative index', () => {
    expect(setColumnRatio(base(), 0, Number.NaN).columnRatios).toEqual({});
    expect(setColumnRatio(base(), -1, 30).columnRatios).toEqual({});
  });

  test('resetColumnRatio removes the adjustment', () => {
    const s = resetColumnRatio(setColumnRatio(setColumnRatio(base(), 0, 30), 1, 70), 0);
    expect(s.columnRatios).toEqual({ 1: 70 });
  });
});

describe('fit override helpers', () => {
  test('a saved fit applies to the target whose anchor matches; an edited target stays unmatched', () => {
    const edited = { anchor: { tag: 'table', textHash: '0000eeee', occurrence: 0 }, mode: 'shrink' as const };
    const state = restoreState(
      saved({ fits: [{ anchor: fitAnchors[1], mode: 'scale', scalePercent: 80 }, edited] }),
      anchors,
    );
    expect(state.fitOverrides).toEqual({ 1: { mode: 'scale', scalePercent: 80 } });
    expect(state.unmatched.fits).toEqual([edited]);
  });

  test('setFitOverride clamps the scale to 50..100 and rounds to an integer', () => {
    const scaled = (n: number) => setFitOverride(base(), 0, { mode: 'scale', scalePercent: n }).fitOverrides;
    expect(scaled(30)).toEqual({ 0: { mode: 'scale', scalePercent: 50 } });
    expect(scaled(120)).toEqual({ 0: { mode: 'scale', scalePercent: 100 } });
    expect(scaled(72)).toEqual({ 0: { mode: 'scale', scalePercent: 72 } });
    expect(scaled(72.4)).toEqual({ 0: { mode: 'scale', scalePercent: 72 } });
  });

  test('setFitOverride stores shrink, and ignores a non-integer or negative index and a non-finite scale', () => {
    expect(setFitOverride(base(), 1, { mode: 'shrink' }).fitOverrides).toEqual({ 1: { mode: 'shrink' } });
    expect(setFitOverride(base(), 0.5, { mode: 'shrink' }).fitOverrides).toEqual({});
    expect(setFitOverride(base(), -1, { mode: 'shrink' }).fitOverrides).toEqual({});
    expect(setFitOverride(base(), 0, { mode: 'scale', scalePercent: Number.NaN }).fitOverrides).toEqual({});
  });

  test('setFitOverride stores its own shrink value, not the caller object', () => {
    const callers = { mode: 'shrink', scalePercent: 70 } as const;
    const stored = setFitOverride(base(), 0, callers).fitOverrides[0];
    expect(stored).toStrictEqual({ mode: 'shrink' });
    expect(stored).not.toBe(callers);
  });

  test('resetFitOverride removes the override back to auto', () => {
    const s = resetFitOverride(setFitOverride(setFitOverride(base(), 0, { mode: 'shrink' }), 1, { mode: 'shrink' }), 0);
    expect(s.fitOverrides).toEqual({ 1: { mode: 'shrink' } });
  });
});

describe('removeUnmatched and resetToAuto', () => {
  const orphanBreak = { anchor: { tag: 'h3', textHash: '0000ffff', occurrence: 0 } };
  const orphanImage = { anchor: { kind: 'img' as const, key: '/gone.png', occurrence: 0 }, widthPercent: 30 };
  const orphanColumn = { anchor: { tag: 'div', textHash: '0000cccc', occurrence: 0 }, leftPercent: 25 };
  const orphanFit = { anchor: { tag: 'table', textHash: '0000dddd', occurrence: 0 }, mode: 'shrink' as const };
  const orphanHidden = { anchor: { tag: 'h3', textHash: '0000eeee', parents: ['00000001'], occurrence: 0 }, label: '消えた節' };
  const withOrphans = (): EditState => ({
    ...setHidden(
      setFitOverride(setColumnRatio(setImageWidth(addBreak(base(), 2, 4), 0, 50), 1, 60), 0, { mode: 'shrink' }),
      3,
      true,
      headingIndexes,
    ),
    setup: { ...base().setup, orientation: 'landscape' },
    unmatched: { breaks: [orphanBreak], images: [orphanImage], columns: [orphanColumn], fits: [orphanFit], hidden: [orphanHidden] },
  });

  test('removeUnmatched removes by kind and index', () => {
    expect(removeUnmatched(withOrphans(), 'break', 0).unmatched).toEqual({
      breaks: [],
      images: [orphanImage],
      columns: [orphanColumn],
      fits: [orphanFit],
      hidden: [orphanHidden],
    });
    expect(removeUnmatched(withOrphans(), 'image', 0).unmatched).toEqual({
      breaks: [orphanBreak],
      images: [],
      columns: [orphanColumn],
      fits: [orphanFit],
      hidden: [orphanHidden],
    });
    expect(removeUnmatched(withOrphans(), 'column', 0).unmatched).toEqual({
      breaks: [orphanBreak],
      images: [orphanImage],
      columns: [],
      fits: [orphanFit],
      hidden: [orphanHidden],
    });
    expect(removeUnmatched(withOrphans(), 'fit', 0).unmatched).toEqual({
      breaks: [orphanBreak],
      images: [orphanImage],
      columns: [orphanColumn],
      fits: [],
      hidden: [orphanHidden],
    });
    expect(removeUnmatched(withOrphans(), 'hidden', 0).unmatched).toEqual({
      breaks: [orphanBreak],
      images: [orphanImage],
      columns: [orphanColumn],
      fits: [orphanFit],
      hidden: [],
    });
  });

  test('resetToAuto restores the default setup and clears every adjustment, unmatched ones included', () => {
    const s = resetToAuto(withOrphans());
    expect(s.setup).toEqual(defaultLayout('', '').page);
    expect(s.breaks).toEqual([]);
    expect(s.imageWidths).toEqual({});
    expect(s.columnRatios).toEqual({});
    expect(s.fitOverrides).toEqual({});
    expect(s.hidden).toEqual([]);
    expect(s.unmatched).toEqual({ breaks: [], images: [], columns: [], fits: [], hidden: [] });
  });
});

describe('toLayout', () => {
  test('stamps the current source, writes anchors for adjustments and re-saves unmatched entries unchanged', () => {
    const orphanBreak = { anchor: { tag: 'h3', textHash: '0000ffff', occurrence: 0 } };
    const orphanImage = { anchor: { kind: 'img' as const, key: '/gone.png', occurrence: 0 }, widthPercent: 30 };
    const orphanColumn = { anchor: { tag: 'div', textHash: '0000cccc', occurrence: 0 }, leftPercent: 25 };
    const orphanFit = { anchor: { tag: 'table', textHash: '0000dddd', occurrence: 0 }, mode: 'shrink' as const };
    const orphanHidden = { anchor: { tag: 'h3', textHash: '0000eeee', parents: ['00000001'], occurrence: 0 }, label: '消えた節' };
    const adjusted = setFitOverride(
        setFitOverride(setColumnRatio(setImageWidth(addBreak(addBreak(base(), 3, 4), 1, 4), 1, 55), 1, 30), 1, {
          mode: 'scale',
          scalePercent: 70,
        }),
        0,
        { mode: 'shrink' },
      );
    const state: EditState = {
      ...setHidden(setHidden(adjusted, 3, true, headingIndexes), 0, true, headingIndexes),
      unmatched: { breaks: [orphanBreak], images: [orphanImage], columns: [orphanColumn], fits: [orphanFit], hidden: [orphanHidden] },
    };
    expect(toLayout(state, anchors, { id: 'src', revisionId: 'rev9' })).toEqual({
      version: 1,
      sourcePageId: 'src',
      sourceRevisionId: 'rev9',
      page: state.setup,
      breaks: [{ anchor: blockAnchors[1] }, { anchor: blockAnchors[3] }, orphanBreak],
      images: [{ anchor: imageAnchors[1], widthPercent: 55 }, orphanImage],
      columns: [{ anchor: columnAnchors[1], leftPercent: 30 }, orphanColumn],
      fits: [
        { anchor: fitAnchors[0], mode: 'shrink' },
        { anchor: fitAnchors[1], mode: 'scale', scalePercent: 70 },
        orphanFit,
      ],
      hidden: [{ anchor: headings[0].anchor, label: '第1部' }, { anchor: headings[1].anchor, label: '概要' }, orphanHidden],
    });
  });
});

describe('hidden headings', () => {
  test('setHidden toggles a heading and keeps the list sorted and unique', () => {
    let s = setHidden(base(), 3, true, headingIndexes);
    s = setHidden(s, 0, true, headingIndexes);
    s = setHidden(s, 3, true, headingIndexes);
    expect(s.hidden).toEqual([0, 3]);
    expect(setHidden(s, 3, false, headingIndexes).hidden).toEqual([0]);
  });

  test('setHidden ignores a block that is not a heading', () => {
    expect(setHidden(base(), 1, true, headingIndexes).hidden).toEqual([]);
    expect(setHidden(base(), 9, true, headingIndexes).hidden).toEqual([]);
  });

  test('setHidden does not mutate the input', () => {
    const before = setHidden(base(), 0, true, headingIndexes);
    const snapshot = structuredClone(before);
    setHidden(before, 3, true, headingIndexes);
    setHidden(before, 0, false, headingIndexes);
    expect(before).toEqual(snapshot);
  });

  test('hidden headings round-trip through toLayout and restoreState', () => {
    const state = setHidden(base(), 3, true, headingIndexes);
    const layout = toLayout(state, anchors, { id: 'src', revisionId: 'rev' });
    expect(layout.hidden).toEqual([{ anchor: headings[1].anchor, label: '概要' }]);
    const restored = restoreState(layout, anchors);
    expect(restored.hidden).toEqual([3]);
    expect(restored.unmatched.hidden).toEqual([]);
  });

  test('an unmatched hidden entry is kept and re-saved unchanged', () => {
    const orphan = { anchor: { tag: 'h2', textHash: '0000ffff', parents: ['00000001'], occurrence: 0 }, label: '消えた章' };
    const restored = restoreState(saved({ hidden: [orphan, { anchor: headings[0].anchor, label: '第1部' }] }), anchors);
    expect(restored.hidden).toEqual([0]);
    expect(restored.unmatched.hidden).toEqual([orphan]);
    expect(toLayout(restored, anchors, { id: 'p', revisionId: 'r' }).hidden).toEqual([
      { anchor: headings[0].anchor, label: '第1部' },
      orphan,
    ]);
  });

  test('a hidden entry whose ancestor heading text changed no longer matches', () => {
    const changedParent = { anchor: { ...headings[1].anchor, parents: ['0000abcd'] }, label: '概要' };
    const restored = restoreState(saved({ hidden: [changedParent] }), anchors);
    expect(restored.hidden).toEqual([]);
    expect(restored.unmatched.hidden).toEqual([changedParent]);
  });
});

describe('repeated headings across chapters (spec 5.4.3)', () => {
  const chapters = (names: readonly string[]): Element[] => {
    const root = document.createElement('div');
    root.innerHTML = names.map((n) => `<h2>${n}</h2><h3>概要</h3><p>${n}の概要</p>`).join('');
    return Array.from(root.children);
  };
  const anchorsOf = (blocks: readonly Element[]): ContentAnchors => ({
    blocks: computeBlockAnchors(blocks),
    images: [],
    columns: [],
    fits: [],
    headings: computeHeadings(blocks),
  });
  const overviewOf = (a: ContentAnchors, chapter: string): number => {
    const i = a.headings.findIndex((h) => h.label === chapter);
    return a.headings[i + 1].blockIndex;
  };
  const savedHidingOverviewOf = (chapter: string): LayoutSettings => {
    const before = anchorsOf(chapters(['1章', '2章']));
    const state = setHidden(restoreState(null, before), overviewOf(before, chapter), true, new Set(before.headings.map((h) => h.blockIndex)));
    return toLayout(state, before, { id: 'p', revisionId: 'r' });
  };

  test("deleting an earlier chapter keeps the hide on the later chapter's 概要", () => {
    const after = anchorsOf(chapters(['2章']));
    const restored = restoreState(savedHidingOverviewOf('2章'), after);
    expect(restored.hidden).toEqual([overviewOf(after, '2章')]);
    expect(restored.unmatched.hidden).toEqual([]);
  });

  test("deleting the chapter that held the hide never moves it onto another chapter's 概要", () => {
    const after = anchorsOf(chapters(['1章']));
    const restored = restoreState(savedHidingOverviewOf('2章'), after);
    expect(restored.hidden).toEqual([]);
    expect(restored.unmatched.hidden.map((h) => h.label)).toEqual(['概要']);
  });
});
