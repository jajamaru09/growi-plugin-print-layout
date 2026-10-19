import { fnv1a32Hex, hashSourceOf, normalizeText, withOccurrences } from './anchors';
import type { HiddenAnchor } from './types';

const LABEL_LIMIT = 100;
// An image-only heading would otherwise show as 「非表示: 」 and an empty confirm line.
const EMPTY_LABEL = '（見出しの文字なし）';
const HEADING_TAG = /^H([1-6])$/;

export interface HeadingInfo {
  blockIndex: number;
  level: number;
  label: string;
  anchor: HiddenAnchor;
}

interface RawHeading {
  blockIndex: number;
  level: number;
  label: string;
  tag: string;
  textHash: string;
  parents: string[];
}

/** Only blocks themselves count (spec 5.4.3): a heading inside a list or quote stays part of the section before it. */
export function computeHeadings(blocks: readonly Element[]): HeadingInfo[] {
  const raw: RawHeading[] = [];
  let ancestors: { level: number; textHash: string }[] = [];
  blocks.forEach((el, blockIndex) => {
    const match = HEADING_TAG.exec(el.tagName);
    if (match == null) return;
    const level = Number(match[1]);
    const textHash = fnv1a32Hex(hashSourceOf(el));
    ancestors = ancestors.filter((a) => a.level < level);
    raw.push({
      blockIndex,
      level,
      label: normalizeText(el.textContent ?? '').slice(0, LABEL_LIMIT) || EMPTY_LABEL,
      tag: el.tagName.toLowerCase(),
      textHash,
      parents: ancestors.map((a) => a.textHash),
    });
    ancestors = [...ancestors, { level, textHash }];
  });
  return withOccurrences(raw, (h) => `${h.tag}\u0000${h.textHash}\u0000${h.parents.join(' ')}`).map(
    ({ item, occurrence }) => ({
      blockIndex: item.blockIndex,
      level: item.level,
      label: item.label,
      anchor: { tag: item.tag, textHash: item.textHash, parents: item.parents, occurrence },
    }),
  );
}

/** Blocks `[start, end)` hidden by the heading at `headingBlockIndex`. */
export interface HiddenRange {
  start: number;
  end: number;
  headingBlockIndex: number;
}

/** One range per hidden heading, in block order. */
export function hiddenRanges(
  headings: readonly HeadingInfo[],
  hidden: ReadonlySet<number>,
  blockCount: number,
): HiddenRange[] {
  return headings.flatMap((heading, i) => {
    if (!hidden.has(heading.blockIndex)) return [];
    const next = headings.slice(i + 1).find((h) => h.level <= heading.level);
    return [{ start: heading.blockIndex, end: next?.blockIndex ?? blockCount, headingBlockIndex: heading.blockIndex }];
  });
}

/** Ranges not contained in another range; these get a gray line each. */
export function outermostRanges(ranges: readonly HiddenRange[]): HiddenRange[] {
  return ranges.filter(
    (range) => !ranges.some((other) => other !== range && other.start <= range.start && range.end <= other.end),
  );
}

export function hiddenBlockSet(ranges: readonly HiddenRange[]): Set<number> {
  const blocks = new Set<number>();
  for (const { start, end } of ranges) {
    for (let i = start; i < end; i += 1) blocks.add(i);
  }
  return blocks;
}
