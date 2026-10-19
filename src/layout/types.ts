import type { PaperSize } from '../constants';

export type { PaperSize };
export type Orientation = 'portrait' | 'landscape';

export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PageSetup {
  size: PaperSize;
  widthMm: number;
  heightMm: number;
  orientation: Orientation;
  margin: Margins;
}

export interface BlockAnchor {
  tag: string;
  textHash: string;
  occurrence: number;
}

export interface ImageAnchor {
  kind: 'img' | 'drawio';
  key: string;
  occurrence: number;
}

export interface BreakEntry {
  anchor: BlockAnchor;
}

export interface ImageEntry {
  anchor: ImageAnchor;
  widthPercent: number;
}

export interface ColumnEntry {
  /** Anchor among the two-column layouts, computed like a block anchor. */
  anchor: BlockAnchor;
  /** Share of the DOM-first column, in %. */
  leftPercent: number;
}

export type FitMode = 'shrink' | 'scale';

export type FitEntry =
  | { anchor: BlockAnchor; mode: 'shrink' }
  | { anchor: BlockAnchor; mode: 'scale'; scalePercent: number };

/** A block anchor of a heading, plus the textHash of each ancestor heading, outermost first. */
export interface HiddenAnchor {
  tag: string;
  textHash: string;
  parents: string[];
  occurrence: number;
}

export interface HiddenEntry {
  anchor: HiddenAnchor;
  /** Heading text for display only; never used for matching. */
  label: string;
}

/** A user's choice for one fit target; absence means auto. */
export type FitOverride = { mode: 'shrink' } | { mode: 'scale'; scalePercent: number };

export interface LayoutSettings {
  version: 1;
  sourcePageId: string;
  sourceRevisionId: string;
  page: PageSetup;
  breaks: BreakEntry[];
  images: ImageEntry[];
  columns: ColumnEntry[];
  fits: FitEntry[];
  hidden: HiddenEntry[];
}
