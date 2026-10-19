export type BlockKind = 'table' | 'code' | 'media' | 'container' | 'other';

export interface MeasuredBlock {
  index: number;
  kind: BlockKind;
  /** Includes vertical margins. */
  heightPx: number;
  /** table: body row heights; code: line heights; container: leaf heights (see splitLeaves). */
  unitHeightsPx?: number[];
  /** table thead height, repeated on every fragment. */
  headerHeightPx?: number;
  /** table/code/container non-unit chrome (padding, borders), added once per fragment. */
  fixedHeightPx?: number;
}

/** `unitRange.end` is exclusive. */
export interface Placement {
  blockIndex: number;
  unitRange?: { start: number; end: number };
  scale?: number;
}

export interface Page {
  placements: Placement[];
}

const nonNegative = (x: number | undefined): number =>
  x !== undefined && Number.isFinite(x) && x > 0 ? x : 0;

/** Greedy page builder: one open page plus the list of finished pages. */
class PageBuilder {
  readonly pages: Page[] = [];
  private current: Placement[] = [];
  private used = 0;

  constructor(readonly pageHeight: number) {}

  get isEmpty(): boolean {
    return this.current.length === 0;
  }

  remaining(): number {
    return this.pageHeight - this.used;
  }

  place(placement: Placement, heightPx: number): void {
    this.current.push(placement);
    this.used += heightPx;
  }

  flush(): void {
    if (this.isEmpty) return;
    this.pages.push({ placements: this.current });
    this.current = [];
    this.used = 0;
  }

  /** A scaled placement always occupies a page of its own. */
  placeAlone(placement: Placement): void {
    this.flush();
    this.pages.push({ placements: [placement] });
  }
}

const splitIntoFragments = (
  builder: PageBuilder,
  blockIndex: number,
  chromePx: number,
  units: readonly number[],
): void => {
  const pageHeight = builder.pageHeight;
  let i = 0;
  while (i < units.length) {
    if (chromePx + units[i] > pageHeight) {
      builder.placeAlone({
        blockIndex,
        unitRange: { start: i, end: i + 1 },
        scale: pageHeight / (chromePx + units[i]),
      });
      i += 1;
      continue;
    }
    if (chromePx + units[i] > builder.remaining()) builder.flush();
    const start = i;
    let fragmentHeight = chromePx;
    while (i < units.length && fragmentHeight + units[i] <= builder.remaining()) {
      fragmentHeight += units[i];
      i += 1;
    }
    builder.place({ blockIndex, unitRange: { start, end: i } }, fragmentHeight);
    if (i < units.length) builder.flush();
  }
};

export function paginate(
  blocks: readonly MeasuredBlock[],
  pageHeightPx: number,
  forcedBreakBefore: ReadonlySet<number>,
): Page[] {
  if (!Number.isFinite(pageHeightPx) || pageHeightPx <= 0) {
    throw new Error(`paginate: pageHeightPx must be a positive finite number, got ${pageHeightPx}`);
  }
  const builder = new PageBuilder(pageHeightPx);

  for (const block of blocks) {
    if (forcedBreakBefore.has(block.index)) builder.flush();
    const heightPx = nonNegative(block.heightPx);

    if (heightPx <= builder.remaining()) {
      builder.place({ blockIndex: block.index }, heightPx);
      continue;
    }
    if (heightPx <= pageHeightPx) {
      builder.flush();
      builder.place({ blockIndex: block.index }, heightPx);
      continue;
    }

    const units = (block.unitHeightsPx ?? []).map(nonNegative);
    const splittable =
      (block.kind === 'table' || block.kind === 'code' || block.kind === 'container') && units.length > 0;
    if (!splittable) {
      builder.placeAlone({ blockIndex: block.index, scale: pageHeightPx / heightPx });
      continue;
    }
    const chromePx =
      nonNegative(block.fixedHeightPx) + (block.kind === 'table' ? nonNegative(block.headerHeightPx) : 0);
    splitIntoFragments(builder, block.index, chromePx, units);
  }

  builder.flush();
  return builder.pages;
}
