export const PLUGIN_ID = 'growi-plugin-print-layout';
export const MOUNT_ID = 'growi-plugin-print-layout-root';
export const PRINT_STYLE_ID = 'growi-plugin-print-layout-print-style';

export type PaperSize = 'A4' | 'A3' | 'B5';

// B5 is the JIS variant (182 x 257 mm), not the ISO one.
export const PAPER_SIZES_MM: Record<PaperSize, { widthMm: number; heightMm: number }> = {
  A4: { widthMm: 210, heightMm: 297 },
  A3: { widthMm: 297, heightMm: 420 },
  B5: { widthMm: 182, heightMm: 257 },
};

export const DEFAULT_MARGINS_MM = { top: 15, bottom: 15, left: 20, right: 20 } as const;

export const MARGIN_RANGE_MM = { min: 0, max: 50 } as const;
export const WIDTH_PERCENT_RANGE = { min: 5, max: 100 } as const;
/** Share of a two-column layout taken by its left column, in %. */
export const COLUMN_PERCENT_RANGE = { min: 10, max: 90 } as const;
export const COLUMN_PERCENT_STEP = 5;

/** Fixed scale for an overflowing table or code block, in %. */
export const FIT_SCALE_RANGE = { min: 50, max: 100 } as const;
export const FIT_SCALE_STEP = 5;
/** Auto / shrink results below this scale are flagged as hard to read. */
export const FIT_WARN_SCALE = 0.6;

export const mmToPx = (mm: number): number => (mm * 96) / 25.4;
