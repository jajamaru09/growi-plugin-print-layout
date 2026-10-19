import { FIT_WARN_SCALE } from '../constants';
import type { FitOverride } from '../layout';

export interface FitInput {
  override: FitOverride | undefined;
  /** Width of the target as laid out: with wrapping unless the override is shrink. */
  naturalPx: number;
  /** Content-box width of the target's container. */
  availablePx: number;
}

export interface FitDecision {
  wrap: boolean;
  scale: number;
}

export type FitWarning = 'small' | 'overflow';

// The epsilon keeps ratios like 0.57 (0.57 * 100 = 56.99999999999999) from flooring one step down.
const floor2 = (x: number): number => Math.floor(x * 100 + 1e-9) / 100;

// scrollWidth is rounded to whole pixels while the container width is fractional, so a block that
// fits can read up to 1px wider than its container.
const ROUNDING_TOLERANCE_PX = 1;

const MIN_SCALE = 0.01;

const isPositive = (x: number): boolean => Number.isFinite(x) && x > 0;

const shrinkToFit = (naturalPx: number, availablePx: number): number => {
  if (!isPositive(naturalPx) || !isPositive(availablePx)) return 1;
  return naturalPx <= availablePx + ROUNDING_TOLERANCE_PX ? 1 : floor2(availablePx / naturalPx);
};

/** Whether cells and code lines wrap: everything but shrink-only does. */
export const wrapsFor = (override: FitOverride | undefined): boolean => override?.mode !== 'shrink';

export function decideFit({ override, naturalPx, availablePx }: FitInput): FitDecision {
  const wrap = wrapsFor(override);
  if (override?.mode === 'scale') {
    return { wrap, scale: isPositive(override.scalePercent) ? override.scalePercent / 100 : 1 };
  }
  return { wrap, scale: shrinkToFit(naturalPx, availablePx) };
}

/**
 * The next scale to try for a target laid out `renderedPx` wide at `scale`, or null when it fits. Glyph
 * widths and borders round at a zoom, so a table held at its min-content can lay out wider than
 * scale x natural width.
 */
export function nextScale(scale: number, availablePx: number, renderedPx: number): number | null {
  if (!isPositive(renderedPx) || !isPositive(availablePx) || renderedPx <= availablePx + ROUNDING_TOLERANCE_PX) return null;
  if (scale <= MIN_SCALE) return null;
  const byOvershoot = floor2((scale * availablePx) / renderedPx);
  const oneStepDown = Math.round(scale * 100 - 1) / 100;
  return Math.max(MIN_SCALE, Math.min(byOvershoot, oneStepDown));
}

export function fitWarning({ override, naturalPx, availablePx }: FitInput, { scale }: FitDecision): FitWarning | null {
  // A block that was measured but has no measurable room may be clipped; it must not pass silently.
  if (isPositive(naturalPx) && !isPositive(availablePx)) return 'overflow';
  if (naturalPx * scale > availablePx + ROUNDING_TOLERANCE_PX) return 'overflow';
  if (override?.mode === 'scale') return null;
  return scale < FIT_WARN_SCALE ? 'small' : null;
}
