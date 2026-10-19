import { COLUMN_PERCENT_RANGE, FIT_SCALE_RANGE, WIDTH_PERCENT_RANGE } from '../constants';
import {
  type BlockAnchor,
  type BreakEntry,
  type ColumnEntry,
  defaultLayout,
  type FitEntry,
  type FitOverride,
  type HeadingInfo,
  type HiddenAnchor,
  type HiddenEntry,
  type ImageAnchor,
  type ImageEntry,
  type LayoutSettings,
  matchAnchors,
  type PageSetup,
} from '../layout';

export interface UnmatchedEntries {
  breaks: BreakEntry[];
  images: ImageEntry[];
  columns: ColumnEntry[];
  fits: FitEntry[];
  hidden: HiddenEntry[];
}

export type { FitOverride };

export interface ContentAnchors {
  blocks: BlockAnchor[];
  images: ImageAnchor[];
  /** Anchors of `content.columns`, computed among the columns like block anchors. */
  columns: BlockAnchor[];
  /** Anchors of `content.fits`, computed among the fit targets like block anchors. */
  fits: BlockAnchor[];
  headings: HeadingInfo[];
}

/** What the user is editing: adjustments are keyed by block / image / column index of the captured content. */
export interface EditState {
  setup: PageSetup;
  /** Block indexes that start a new page; sorted, unique, never 0. */
  breaks: readonly number[];
  /** Image index -> width in % of the content width. */
  imageWidths: Readonly<Record<number, number>>;
  /** Column index (of the captured two-column layouts) -> share of the DOM-first column in %. */
  columnRatios: Readonly<Record<number, number>>;
  /** Fit index (of the captured tables / code blocks) -> override; absent = auto. */
  fitOverrides: Readonly<Record<number, FitOverride>>;
  /** Block indexes of the headings the user hid; sorted, unique. */
  hidden: readonly number[];
  /** Saved entries whose anchor matched nothing; re-saved unchanged until removed. */
  unmatched: UnmatchedEntries;
}

const sameBlock = (a: BlockAnchor, b: BlockAnchor): boolean =>
  a.tag === b.tag && a.textHash === b.textHash && a.occurrence === b.occurrence;

const sameImage = (a: ImageAnchor, b: ImageAnchor): boolean =>
  a.kind === b.kind && a.key === b.key && a.occurrence === b.occurrence;

const sameHidden = (a: HiddenAnchor, b: HiddenAnchor): boolean =>
  a.tag === b.tag &&
  a.textHash === b.textHash &&
  a.occurrence === b.occurrence &&
  a.parents.length === b.parents.length &&
  a.parents.every((p, i) => p === b.parents[i]);

const defaultSetup = (): PageSetup => defaultLayout('', '').page;

const noAdjustments = (): Omit<EditState, 'setup'> => ({
  breaks: [],
  imageWidths: {},
  columnRatios: {},
  fitOverrides: {},
  hidden: [],
  unmatched: { breaks: [], images: [], columns: [], fits: [], hidden: [] },
});

const entryToOverride = (entry: FitEntry): FitOverride =>
  entry.mode === 'shrink' ? { mode: 'shrink' } : { mode: 'scale', scalePercent: entry.scalePercent };

export function restoreState(saved: LayoutSettings | null, anchors: ContentAnchors): EditState {
  if (saved == null) return { setup: defaultSetup(), ...noAdjustments() };
  const breakMatch = matchAnchors(saved.breaks, anchors.blocks, sameBlock);
  const imageMatch = matchAnchors(saved.images, anchors.images, sameImage);
  const columnMatch = matchAnchors(saved.columns, anchors.columns, sameBlock);
  const fitMatch = matchAnchors(saved.fits, anchors.fits, sameBlock);
  const hiddenMatch = matchAnchors(
    saved.hidden,
    anchors.headings.map((h) => h.anchor),
    sameHidden,
  );
  // A break on the first block cannot start a new page, so it counts as not applied.
  const onFirstBlock = breakMatch.matched.filter((m) => m.index === 0).map((m) => m.entry);
  const breaks = breakMatch.matched
    .map((m) => m.index)
    .filter((i) => i > 0)
    .sort((a, b) => a - b);
  const imageWidths = Object.fromEntries(imageMatch.matched.map((m) => [m.index, m.entry.widthPercent]));
  const columnRatios = Object.fromEntries(columnMatch.matched.map((m) => [m.index, m.entry.leftPercent]));
  const fitOverrides = Object.fromEntries(fitMatch.matched.map((m) => [m.index, entryToOverride(m.entry)]));
  const hidden = hiddenMatch.matched.map((m) => anchors.headings[m.index].blockIndex).sort((a, b) => a - b);
  return {
    setup: saved.page,
    breaks,
    imageWidths,
    columnRatios,
    fitOverrides,
    hidden,
    unmatched: {
      breaks: [...onFirstBlock, ...breakMatch.unmatched],
      images: imageMatch.unmatched,
      columns: columnMatch.unmatched,
      fits: fitMatch.unmatched,
      hidden: hiddenMatch.unmatched,
    },
  };
}

const isBlockIndex = (index: number, blockCount: number): boolean =>
  Number.isInteger(index) && index > 0 && index < blockCount;

export function addBreak(state: EditState, blockIndex: number, blockCount: number): EditState {
  if (!isBlockIndex(blockIndex, blockCount) || state.breaks.includes(blockIndex)) return state;
  return { ...state, breaks: [...state.breaks, blockIndex].sort((a, b) => a - b) };
}

export function removeBreak(state: EditState, blockIndex: number): EditState {
  return { ...state, breaks: state.breaks.filter((i) => i !== blockIndex) };
}

export function moveBreak(state: EditState, fromBlockIndex: number, toBlockIndex: number, blockCount: number): EditState {
  if (!state.breaks.includes(fromBlockIndex) || !isBlockIndex(toBlockIndex, blockCount)) return state;
  return addBreak(removeBreak(state, fromBlockIndex), toBlockIndex, blockCount);
}

export function setImageWidth(state: EditState, imageIndex: number, widthPercent: number): EditState {
  if (!Number.isFinite(widthPercent) || !Number.isInteger(imageIndex) || imageIndex < 0) return state;
  const clamped = Math.min(WIDTH_PERCENT_RANGE.max, Math.max(WIDTH_PERCENT_RANGE.min, Math.round(widthPercent)));
  return { ...state, imageWidths: { ...state.imageWidths, [imageIndex]: clamped } };
}

export function resetImageWidth(state: EditState, imageIndex: number): EditState {
  const { [imageIndex]: _removed, ...rest } = state.imageWidths;
  return { ...state, imageWidths: rest };
}

export function setColumnRatio(state: EditState, columnIndex: number, leftPercent: number): EditState {
  if (!Number.isFinite(leftPercent) || !Number.isInteger(columnIndex) || columnIndex < 0) return state;
  const clamped = Math.min(COLUMN_PERCENT_RANGE.max, Math.max(COLUMN_PERCENT_RANGE.min, Math.round(leftPercent)));
  return { ...state, columnRatios: { ...state.columnRatios, [columnIndex]: clamped } };
}

export function resetColumnRatio(state: EditState, columnIndex: number): EditState {
  const { [columnIndex]: _removed, ...rest } = state.columnRatios;
  return { ...state, columnRatios: rest };
}

export function setFitOverride(state: EditState, fitIndex: number, override: FitOverride): EditState {
  if (!Number.isInteger(fitIndex) || fitIndex < 0) return state;
  if (override.mode === 'shrink') return { ...state, fitOverrides: { ...state.fitOverrides, [fitIndex]: { mode: 'shrink' } } };
  if (!Number.isFinite(override.scalePercent)) return state;
  const scalePercent = Math.min(FIT_SCALE_RANGE.max, Math.max(FIT_SCALE_RANGE.min, Math.round(override.scalePercent)));
  return { ...state, fitOverrides: { ...state.fitOverrides, [fitIndex]: { mode: 'scale', scalePercent } } };
}

export function resetFitOverride(state: EditState, fitIndex: number): EditState {
  const { [fitIndex]: _removed, ...rest } = state.fitOverrides;
  return { ...state, fitOverrides: rest };
}

export function setHidden(
  state: EditState,
  headingBlockIndex: number,
  hidden: boolean,
  headingBlockIndexes: ReadonlySet<number>,
): EditState {
  if (!headingBlockIndexes.has(headingBlockIndex)) return state;
  const others = state.hidden.filter((i) => i !== headingBlockIndex);
  return { ...state, hidden: hidden ? [...others, headingBlockIndex].sort((a, b) => a - b) : others };
}

export type UnmatchedKind = 'break' | 'image' | 'column' | 'fit' | 'hidden';

const UNMATCHED_KEYS = {
  break: 'breaks',
  image: 'images',
  column: 'columns',
  fit: 'fits',
  hidden: 'hidden',
} as const;

export function removeUnmatched(state: EditState, kind: UnmatchedKind, index: number): EditState {
  const key = UNMATCHED_KEYS[kind];
  return {
    ...state,
    unmatched: { ...state.unmatched, [key]: state.unmatched[key].filter((_, i) => i !== index) },
  };
}

/** Clears every adjustment, unmatched ones included: it is an explicit user action (spec 5.5). */
export function resetToAuto(state: EditState): EditState {
  return { ...state, setup: defaultSetup(), ...noAdjustments() };
}

/** Index -> value records become entries sorted by index, for indexes that still have an anchor. */
const indexedEntries = <A, V, E>(
  values: Readonly<Record<number, V>>,
  anchors: readonly A[],
  toEntry: (anchor: A, value: V) => E,
): E[] =>
  Object.entries(values)
    .map(([key, value]) => ({ index: Number(key), value }))
    .filter(({ index }) => anchors[index] != null)
    .sort((a, b) => a.index - b.index)
    .map(({ index, value }) => toEntry(anchors[index], value));

export function toLayout(
  state: EditState,
  anchors: ContentAnchors,
  source: { id: string; revisionId: string },
): LayoutSettings {
  const breaks: BreakEntry[] = state.breaks
    .filter((i) => anchors.blocks[i] != null)
    .map((i) => ({ anchor: anchors.blocks[i] }));
  const headingAt = new Map(anchors.headings.map((h) => [h.blockIndex, h]));
  const hidden: HiddenEntry[] = state.hidden.flatMap((i) => {
    const heading = headingAt.get(i);
    return heading == null ? [] : [{ anchor: heading.anchor, label: heading.label }];
  });
  const images: ImageEntry[] = indexedEntries(state.imageWidths, anchors.images, (anchor, widthPercent) => ({
    anchor,
    widthPercent,
  }));
  const columns: ColumnEntry[] = indexedEntries(state.columnRatios, anchors.columns, (anchor, leftPercent) => ({
    anchor,
    leftPercent,
  }));
  const fits: FitEntry[] = indexedEntries(state.fitOverrides, anchors.fits, (anchor, override): FitEntry =>
    override.mode === 'shrink' ? { anchor, mode: 'shrink' } : { anchor, mode: 'scale', scalePercent: override.scalePercent },
  );
  return {
    version: 1,
    sourcePageId: source.id,
    sourceRevisionId: source.revisionId,
    page: state.setup,
    breaks: [...breaks, ...state.unmatched.breaks],
    images: [...images, ...state.unmatched.images],
    columns: [...columns, ...state.unmatched.columns],
    fits: [...fits, ...state.unmatched.fits],
    hidden: [...hidden, ...state.unmatched.hidden],
  };
}
