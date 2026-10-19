import { DRAWIO_ATTR } from '../dom-attributes';
import type { BlockAnchor, ImageAnchor } from './types';

const TEXT_LIMIT = 200;
const TAG_MAX_LENGTH = 16;
const IMAGE_KEY_MAX_LENGTH = 2048;

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT);
}

export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// The stored-layout validator only accepts /^[a-z][a-z0-9]{0,15}$/, so custom
// element names ("my-widget") are folded into that alphabet.
function toAnchorTag(element: Element): string {
  const folded = element.tagName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, TAG_MAX_LENGTH);
  return /^[a-z]/.test(folded) ? folded : `x${folded}`.slice(0, TAG_MAX_LENGTH);
}

export function withOccurrences<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): { item: T; occurrence: number }[] {
  const counts = new Map<string, number>();
  return items.map((item) => {
    const key = keyOf(item);
    const occurrence = counts.get(key) ?? 0;
    counts.set(key, occurrence + 1);
    return { item, occurrence };
  });
}

// Keys outside 1..2048 chars are rejected by the validator, so hash them.
function toAnchorKey(key: string): string {
  return key.length === 0 || key.length > IMAGE_KEY_MAX_LENGTH
    ? `h:${fnv1a32Hex(key)}`
    : key;
}

const DRAWIO_SELECTOR = `[${DRAWIO_ATTR}]`;

const drawioToken = (diagram: Element): string =>
  ` drawio:${toAnchorKey(diagram.getAttribute(DRAWIO_ATTR) ?? '')} `;

/**
 * Text of `el` with each drawio diagram replaced by its key: the labels inside
 * differ between the static render and the inline-svg fallback.
 */
function textWithDiagramKeys(el: Element): string {
  if (el.hasAttribute(DRAWIO_ATTR)) return drawioToken(el);
  return Array.from(el.childNodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return (node as Text).data;
      return node instanceof Element ? textWithDiagramKeys(node) : '';
    })
    .join('');
}

const selfAndDescendants = (el: Element, selector: string): Element[] => [
  ...(el.matches(selector) ? [el] : []),
  ...Array.from(el.querySelectorAll(selector)),
];

/**
 * Stands in for the text of a block that has none, so that blocks such as photos
 * do not all share one anchor: its image keys, else its tag and child tags. The
 * NUL prefix keeps it apart from any real text.
 */
function contentKeyOf(el: Element): string {
  const images = selfAndDescendants(el, 'img')
    .filter((img) => img.closest(DRAWIO_SELECTOR) == null)
    .map((img) => toAnchorKey(img.getAttribute('src') ?? ''));
  if (images.length > 0) return `\u0000img ${images.join(' ')}`;
  const tags = [el, ...Array.from(el.children)].map((child) => child.tagName.toLowerCase());
  return `\u0000tags ${tags.join(' ')}`;
}

export const hashSourceOf = (el: Element): string => normalizeText(textWithDiagramKeys(el)) || contentKeyOf(el);

export function computeBlockAnchors(blocks: readonly Element[]): BlockAnchor[] {
  const keyed = blocks.map((el) => ({
    tag: toAnchorTag(el),
    textHash: fnv1a32Hex(hashSourceOf(el)),
  }));
  return withOccurrences(keyed, (k) => `${k.tag}\u0000${k.textHash}`).map(
    ({ item, occurrence }) => ({ ...item, occurrence }),
  );
}

export interface ImageTarget {
  element: HTMLElement;
  kind: 'img' | 'drawio';
  key: string;
}

export function computeImageAnchors(
  targets: readonly ImageTarget[],
): ImageAnchor[] {
  const normalized = targets.map((t) => ({
    kind: t.kind,
    key: toAnchorKey(t.key),
  }));
  return withOccurrences(normalized, (t) => `${t.kind}\u0000${t.key}`).map(
    ({ item, occurrence }) => ({ ...item, occurrence }),
  );
}

export function matchAnchors<A, E extends { anchor: A }>(
  saved: readonly E[],
  current: readonly A[],
  equals: (a: A, b: A) => boolean,
): { matched: { entry: E; index: number }[]; unmatched: E[] } {
  const taken = new Set<number>();
  const matched: { entry: E; index: number }[] = [];
  const unmatched: E[] = [];
  for (const entry of saved) {
    const index = current.findIndex(
      (a, i) => !taken.has(i) && equals(entry.anchor, a),
    );
    if (index === -1) {
      unmatched.push(entry);
    } else {
      taken.add(index);
      matched.push({ entry, index });
    }
  }
  return { matched, unmatched };
}
