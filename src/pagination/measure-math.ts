/**
 * Turns ordered start positions into extents: each runs to the next start, the
 * last to `end`. A null start (element without layout) takes the next known
 * start, so it gets a zero extent; backwards steps clamp to zero.
 */
export function spansBetween(starts: readonly (number | null)[], end: number): number[] {
  const resolved: number[] = new Array(starts.length);
  let next = end;
  for (let i = starts.length - 1; i >= 0; i -= 1) {
    const start = starts[i];
    resolved[i] = start ?? next;
    next = resolved[i];
  }
  return resolved.map((start, i) => Math.max(0, (resolved[i + 1] ?? end) - start));
}

/**
 * Groups laid-out children into vertical bands: a child opens a new band only once it clears the
 * tallest one before it, so children that stack get a band each while those sharing a line (a
 * wrapped flex row) share one. Returns the band index of each child; one without layout (null)
 * joins the band around it.
 */
export function bandsOf(extents: readonly ({ top: number; bottom: number } | null)[]): number[] {
  const EPSILON = 0.5;
  const bands: number[] = [];
  let index = -1;
  // null until the current band holds a laid-out child, so a leading one does not open a band of its own.
  let bottom: number | null = null;
  for (const extent of extents) {
    if (index < 0) index = 0;
    if (extent != null) {
      if (bottom != null && extent.top >= bottom - EPSILON) {
        index += 1;
        bottom = extent.bottom;
      } else {
        bottom = bottom == null ? extent.bottom : Math.max(bottom, extent.bottom);
      }
    }
    bands.push(index);
  }
  return bands;
}

/** The part of a block that is neither header nor units (padding, borders, margins). */
export function fixedHeight(totalPx: number, headerPx: number, unitsPx: readonly number[]): number {
  const sum = unitsPx.reduce((acc, u) => acc + u, 0);
  return Math.max(0, totalPx - headerPx - sum);
}

/** Offsets at which each line starts; one trailing newline does not open a new line. */
export function lineStartOffsets(text: string): number[] {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (text.length === 0) return [];
  const starts = [0];
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** Maps an offset into concatenated text segments to (segment, offset within it). */
export function locateTextOffset(
  segmentLengths: readonly number[],
  offset: number,
): { segment: number; offset: number } {
  let base = 0;
  for (let i = 0; i < segmentLengths.length; i += 1) {
    const length = segmentLengths[i];
    if (offset < base + length) return { segment: i, offset: offset - base };
    base += length;
  }
  const last = segmentLengths.length - 1;
  return { segment: last, offset: segmentLengths[last] ?? 0 };
}
