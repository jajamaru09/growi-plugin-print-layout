import {
  COLUMN_PERCENT_RANGE,
  DEFAULT_MARGINS_MM,
  FIT_SCALE_RANGE,
  MARGIN_RANGE_MM,
  PAPER_SIZES_MM,
  WIDTH_PERCENT_RANGE,
} from '../constants';
import type {
  BlockAnchor,
  BreakEntry,
  ColumnEntry,
  FitEntry,
  HiddenAnchor,
  HiddenEntry,
  ImageAnchor,
  ImageEntry,
  LayoutSettings,
  Margins,
  Orientation,
  PageSetup,
  PaperSize,
} from './types';

const MAX_ENTRIES = 1000;
const MAX_KEY_LENGTH = 2048;
const MAX_OCCURRENCE = 9999;
const MAX_ID_LENGTH = 256;
// h2..h6 have at most five ancestor headings.
const MAX_PARENTS = 5;
const MAX_LABEL_LENGTH = 100;
const TAG_PATTERN = /^[a-z][a-z0-9]{0,15}$/;
const TEXT_HASH_PATTERN = /^[0-9a-f]{8}$/;
const PAPER_SIZE_NAMES: readonly PaperSize[] = ['A4', 'A3', 'B5'];
const ORIENTATIONS: readonly Orientation[] = ['portrait', 'landscape'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNumberInRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const buildPageSetup = (
  size: PaperSize,
  orientation: Orientation,
  margin: Margins,
): PageSetup => ({
  size,
  ...PAPER_SIZES_MM[size],
  orientation,
  margin,
});

const defaultPage = (): PageSetup =>
  buildPageSetup('A4', 'portrait', { ...DEFAULT_MARGINS_MM });

export function defaultLayout(
  sourcePageId: string,
  sourceRevisionId: string,
): LayoutSettings {
  return {
    version: 1,
    sourcePageId,
    sourceRevisionId,
    page: defaultPage(),
    breaks: [],
    images: [],
    columns: [],
    fits: [],
    hidden: [],
  };
}

const parseMargin = (v: unknown): Margins | null => {
  if (!isRecord(v)) return null;
  const { top, bottom, left, right } = v;
  const { min, max } = MARGIN_RANGE_MM;
  if (
    isNumberInRange(top, min, max) &&
    isNumberInRange(bottom, min, max) &&
    isNumberInRange(left, min, max) &&
    isNumberInRange(right, min, max)
  ) {
    return { top, bottom, left, right };
  }
  return null;
};

const parsePage = (v: unknown): PageSetup | null => {
  if (!isRecord(v)) return null;
  const { size, orientation } = v;
  const margin = parseMargin(v.margin);
  if (
    typeof size !== 'string' ||
    !PAPER_SIZE_NAMES.includes(size as PaperSize) ||
    typeof orientation !== 'string' ||
    !ORIENTATIONS.includes(orientation as Orientation) ||
    margin == null
  ) {
    return null;
  }
  return buildPageSetup(size as PaperSize, orientation as Orientation, margin);
};

const isOccurrence = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_OCCURRENCE;

const parseBlockAnchor = (v: unknown): BlockAnchor | null => {
  if (!isRecord(v)) return null;
  const { tag, textHash, occurrence } = v;
  if (
    typeof tag === 'string' &&
    TAG_PATTERN.test(tag) &&
    typeof textHash === 'string' &&
    TEXT_HASH_PATTERN.test(textHash) &&
    isOccurrence(occurrence)
  ) {
    return { tag, textHash, occurrence };
  }
  return null;
};

const parseImageAnchor = (v: unknown): ImageAnchor | null => {
  if (!isRecord(v)) return null;
  const { kind, key, occurrence } = v;
  if (
    (kind === 'img' || kind === 'drawio') &&
    typeof key === 'string' &&
    key.length >= 1 &&
    key.length <= MAX_KEY_LENGTH &&
    isOccurrence(occurrence)
  ) {
    return { kind, key, occurrence };
  }
  return null;
};

const parseBreak = (v: unknown): BreakEntry | null => {
  if (!isRecord(v)) return null;
  const anchor = parseBlockAnchor(v.anchor);
  return anchor == null ? null : { anchor };
};

const parseImage = (v: unknown): ImageEntry | null => {
  if (!isRecord(v)) return null;
  const anchor = parseImageAnchor(v.anchor);
  const { widthPercent } = v;
  if (
    anchor == null ||
    !isNumberInRange(
      widthPercent,
      WIDTH_PERCENT_RANGE.min,
      WIDTH_PERCENT_RANGE.max,
    )
  ) {
    return null;
  }
  return { anchor, widthPercent };
};

const parseColumn = (v: unknown): ColumnEntry | null => {
  if (!isRecord(v)) return null;
  const anchor = parseBlockAnchor(v.anchor);
  const { leftPercent } = v;
  if (
    anchor == null ||
    !Number.isInteger(leftPercent) ||
    !isNumberInRange(leftPercent, COLUMN_PERCENT_RANGE.min, COLUMN_PERCENT_RANGE.max)
  ) {
    return null;
  }
  return { anchor, leftPercent };
};

const parseFit = (v: unknown): FitEntry | null => {
  if (!isRecord(v)) return null;
  const anchor = parseBlockAnchor(v.anchor);
  if (anchor == null) return null;
  if (v.mode === 'shrink') return { anchor, mode: 'shrink' };
  const { scalePercent } = v;
  if (
    v.mode === 'scale' &&
    Number.isInteger(scalePercent) &&
    isNumberInRange(scalePercent, FIT_SCALE_RANGE.min, FIT_SCALE_RANGE.max)
  ) {
    return { anchor, mode: 'scale', scalePercent };
  }
  return null;
};

const parseParents = (v: unknown): string[] | null =>
  Array.isArray(v) &&
  v.length <= MAX_PARENTS &&
  v.every((p) => typeof p === 'string' && TEXT_HASH_PATTERN.test(p))
    ? [...v]
    : null;

const parseHiddenAnchor = (v: unknown): HiddenAnchor | null => {
  const block = parseBlockAnchor(v);
  if (block == null || !isRecord(v)) return null;
  const parents = parseParents(v.parents);
  return parents == null ? null : { ...block, parents };
};

const parseHidden = (v: unknown): HiddenEntry | null => {
  if (!isRecord(v)) return null;
  const anchor = parseHiddenAnchor(v.anchor);
  if (anchor == null || typeof v.label !== 'string') return null;
  return { anchor, label: v.label.slice(0, MAX_LABEL_LENGTH) };
};

const parseEntries = <T>(
  raw: unknown,
  label: string,
  parseOne: (v: unknown) => T | null,
  warnings: string[],
): T[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`${label} is not a list; ignored`);
    return [];
  }
  if (raw.length > MAX_ENTRIES) {
    warnings.push(`${label}: only the first ${MAX_ENTRIES} entries are used`);
  }
  const result: T[] = [];
  raw.slice(0, MAX_ENTRIES).forEach((item, index) => {
    const parsed = parseOne(item);
    if (parsed == null) {
      warnings.push(`${label}[${index}] is invalid; dropped`);
    } else {
      result.push(parsed);
    }
  });
  return result;
};

const sameHiddenAnchor = (a: HiddenAnchor, b: HiddenAnchor): boolean =>
  a.tag === b.tag &&
  a.textHash === b.textHash &&
  a.occurrence === b.occurrence &&
  a.parents.length === b.parents.length &&
  a.parents.every((p, i) => p === b.parents[i]);

// A repeated anchor could match only once, so the copy would stay unmatched and ask before every print.
const dedupeHidden = (entries: readonly HiddenEntry[]): HiddenEntry[] =>
  entries.filter((entry, i) => !entries.slice(0, i).some((earlier) => sameHiddenAnchor(earlier.anchor, entry.anchor)));

/** Saved hide entries that were offered but not read: anything not a list counts as one. */
const offeredCount = (raw: unknown): number => {
  if (raw === undefined) return 0;
  return Array.isArray(raw) ? raw.length : 1;
};

const parseId = (v: unknown): string =>
  typeof v === 'string' ? v.slice(0, MAX_ID_LENGTH) : '';

export function parseLayout(input: unknown): {
  layout: LayoutSettings | null;
  warnings: string[];
  /** Saved hide entries that could not be read (spec 5.4.3: these must still ask before printing). */
  droppedHidden: number;
} {
  if (!isRecord(input)) {
    return { layout: null, warnings: ['Layout data is not an object'], droppedHidden: 0 };
  }
  if (input.version !== 1) {
    return { layout: null, warnings: ['Unsupported layout version'], droppedHidden: 0 };
  }

  const warnings: string[] = [];
  let page = parsePage(input.page);
  if (page == null) {
    warnings.push('page settings are invalid; defaults used');
    page = defaultPage();
  }

  const hidden = parseEntries(input.hidden, 'hidden', parseHidden, warnings);
  return {
    layout: {
      version: 1,
      sourcePageId: parseId(input.sourcePageId),
      sourceRevisionId: parseId(input.sourceRevisionId),
      page,
      breaks: parseEntries(input.breaks, 'breaks', parseBreak, warnings),
      images: parseEntries(input.images, 'images', parseImage, warnings),
      columns: parseEntries(input.columns, 'columns', parseColumn, warnings),
      fits: parseEntries(input.fits, 'fits', parseFit, warnings),
      hidden: dedupeHidden(hidden),
    },
    warnings,
    droppedHidden: offeredCount(input.hidden) - hidden.length,
  };
}
