import type { ImageTarget } from '../layout';
import { fnv1a32Hex } from '../layout';
import { DRAWIO_ATTR, LEAF_ATTR, SPLIT_ATTR } from '../dom-attributes';
import { log } from '../log';
import type { BlockKind } from '../pagination';
import { extractXmlFromWrapper, WRAPPER_SELECTOR } from './drawio-static';
import { stripInteractiveChrome } from './strip-chrome';

const DRAWIO_SELECTOR = `[${DRAWIO_ATTR}]`;

// Confirmed on GROWI 8.0.4: comments render as `.wiki.comment` under
// `.page-comments`, and the editor preview `.wiki` lives under `#page-editor`
// (its preview body has only a CSS-module class, no id).
const NON_MAIN_ANCESTORS = [
  '.page-comments',
  '.page-comment',
  '#page-comments-list',
  '#page-editor',
  '.page-editor-preview-container',
  '[class*="page-editor-preview-body"]',
  '#page-editor-preview-body',
].join(', ');

/** A two-column layout in the captured content (see isTwoColumnFlex). */
export interface ColumnTarget {
  element: HTMLElement;
}

/** A table or code block whose width may overflow the page (see the fit pass). */
export interface FitTarget {
  element: HTMLElement;
  kind: 'table' | 'code';
}

export interface CapturedContent {
  root: HTMLElement;
  blocks: HTMLElement[];
  images: ImageTarget[];
  columns: ColumnTarget[];
  fits: FitTarget[];
}

type StyleGetter = (el: Element) => CSSStyleDeclaration;

const computedStyle: StyleGetter = (el) => (el.ownerDocument.defaultView ?? window).getComputedStyle(el);

/** A horizontal flex container with exactly two element children; class names play no part. */
export function isTwoColumnFlex(el: Element, getStyle: StyleGetter = computedStyle): boolean {
  if (el.children.length !== 2) return false;
  const style = getStyle(el);
  const direction = style.flexDirection || 'row';
  return style.display === 'flex' && (direction === 'row' || direction === 'row-reverse');
}

export function findMainWiki(doc: Document): HTMLElement | null {
  for (const wiki of Array.from(doc.querySelectorAll<HTMLElement>('.wiki'))) {
    if (!wiki.classList.contains('comment') && wiki.closest(NON_MAIN_ANCESTORS) == null) {
      return wiki;
    }
  }
  return null;
}

const staticSvgOrNull = async (
  wrapper: HTMLElement,
  toStaticSvg: (wrapper: HTMLElement) => Promise<SVGSVGElement | null>,
): Promise<SVGSVGElement | null> => {
  try {
    return await toStaticSvg(wrapper);
  } catch (e) {
    log('captureWiki: toStaticSvg threw:', e);
    return null;
  }
};

/** Rendered width of the diagram on the page, or null when it has no layout box. */
const onPageDiagramWidth = (sourceWrapper: HTMLElement | undefined): number | null => {
  const width = sourceWrapper?.querySelector('.mxgraph svg')?.getBoundingClientRect().width ?? 0;
  return width > 0 ? width : null;
};

/**
 * Shows the svg as wide as the diagram was on the page, never wider than its
 * block. The min sizes clear the viewer's inline ones on a fallback svg.
 */
const sizeStaticSvg = (svg: SVGSVGElement, widthPx: number | null): void => {
  if (widthPx != null) svg.style.width = `${widthPx}px`;
  svg.style.maxWidth = '100%';
  svg.style.minWidth = '0px';
  svg.style.height = 'auto';
  svg.style.minHeight = '0px';
};

const outermostWrappers = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(WRAPPER_SELECTOR)).filter(
    (w, _, all) => !all.some((other) => other !== w && other.contains(w)),
  );

/** `wrapper` belongs to the detached clone, so moving its inline svg is safe. */
const replaceDrawioWrapper = async (
  wrapper: HTMLElement,
  widthPx: number | null,
  toStaticSvg: (wrapper: HTMLElement) => Promise<SVGSVGElement | null>,
): Promise<void> => {
  const xml = extractXmlFromWrapper(wrapper)?.xml ?? '';
  let svg: SVGSVGElement | null = await staticSvgOrNull(wrapper, toStaticSvg);
  if (svg == null) {
    log('captureWiki: static drawio svg unavailable; keeping the inline svg');
    svg = wrapper.querySelector<SVGSVGElement>('.mxgraph svg');
  }
  if (svg == null) {
    log('captureWiki: drawio wrapper has no svg; left as is');
    return;
  }
  sizeStaticSvg(svg, widthPx);
  const replacement = wrapper.ownerDocument.createElement('div');
  replacement.setAttribute(DRAWIO_ATTR, xml ? fnv1a32Hex(xml) : '');
  replacement.appendChild(svg);
  wrapper.replaceWith(replacement);
};

const collectImages = (root: HTMLElement): ImageTarget[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`img, ${DRAWIO_SELECTOR}`)).flatMap(
    (element): ImageTarget[] => {
      if (element.hasAttribute(DRAWIO_ATTR)) {
        return [{ element, kind: 'drawio', key: element.getAttribute(DRAWIO_ATTR) ?? '' }];
      }
      // HTML labels inside a drawio svg are part of the diagram, not page images.
      if (element.closest(DRAWIO_SELECTOR) != null) return [];
      return [{ element, kind: 'img', key: element.getAttribute('src') ?? '' }];
    },
  );

/** Pairs every descendant of the fresh clone with its source element; both trees still have the same shape. */
const pairWithSource = (source: HTMLElement, clone: HTMLElement): Map<Element, Element> => {
  const sources = Array.from(source.querySelectorAll('*'));
  const clones = Array.from(clone.querySelectorAll('*'));
  return new Map(clones.map((el, i) => [el, sources[i]]));
};

/**
 * Display comes from the live source (the clone is detached, so class-based CSS does not resolve
 * on it); the child count comes from the stripped clone. Nodes created during capture have no source.
 */
const collectColumns = (root: HTMLElement, sourceOf: ReadonlyMap<Element, Element>, getStyle: StyleGetter): ColumnTarget[] =>
  Array.from(root.querySelectorAll<HTMLElement>('*')).flatMap((element): ColumnTarget[] => {
    const source = sourceOf.get(element);
    // Labels inside a drawio svg are often 2-child flex boxes; they belong to the diagram.
    if (source == null || element.closest(`${DRAWIO_SELECTOR}, svg`) != null) return [];
    return isTwoColumnFlex(element, () => getStyle(source)) ? [{ element }] : [];
  });

/** Outermost tables and code blocks only: a nested one is sized with the block that holds it. */
const collectFits = (root: HTMLElement): FitTarget[] =>
  Array.from(root.querySelectorAll<HTMLElement>('table, pre')).flatMap((element): FitTarget[] => {
    if (element.closest(`${DRAWIO_SELECTOR}, svg`) != null) return [];
    if (element.parentElement?.closest('table, pre') != null) return [];
    return [{ element, kind: element.tagName === 'TABLE' ? 'table' : 'code' }];
  });

const WRAPPER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'BLOCKQUOTE']);
/** Wrappers that may be cut between their children: block ones stack them, flex and grid lay them out in lines. */
const SPLITTABLE_DISPLAYS = new Set(['block', 'flow-root', 'flex', 'grid']);
/** Only these are descended into. A flex or grid child is a cell of a line, so cutting inside it would break the line. */
const STACKING_DISPLAYS = new Set(['block', 'flow-root']);
const BLOCK_LEVEL_DISPLAYS = new Set(['block', 'flow-root', 'flex', 'grid', 'table', 'list-item', 'none']);

const hasOwnText = (el: Element): boolean =>
  Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');

const isInFlow = (style: CSSStyleDeclaration): boolean =>
  (style.float || 'none') === 'none' && style.position !== 'absolute' && style.position !== 'fixed';

/** The computed display of the live source of a captured node, or null for one created during capture. */
const sourceDisplay = (
  el: HTMLElement,
  sourceOf: ReadonlyMap<Element, Element>,
  getStyle: StyleGetter,
): string | null => {
  const source = sourceOf.get(el);
  return source == null ? null : getStyle(source).display;
};

/**
 * A wrapper that lays its element children out in rows (no text of its own, no inline, floated or
 * absolutely positioned children), so cutting it between rows keeps each part intact. A two-column
 * flex is a single row and carries the ratio handles, so it stays one block. Styles come from the
 * live source; nodes created during capture (drawio) count as blocks.
 */
const isSplitWrapper = (
  el: HTMLElement,
  sourceOf: ReadonlyMap<Element, Element>,
  getStyle: StyleGetter,
): boolean => {
  const source = sourceOf.get(el);
  if (source == null || !WRAPPER_TAGS.has(el.tagName) || el.children.length === 0 || hasOwnText(el)) return false;
  const style = getStyle(source);
  if (!SPLITTABLE_DISPLAYS.has(style.display) || !isInFlow(style)) return false;
  if (style.columnCount && style.columnCount !== 'auto') return false;
  if (isTwoColumnFlex(el, () => style)) return false;
  return Array.from(el.children).every((child) => {
    const childSource = sourceOf.get(child);
    if (childSource == null) return true;
    const childStyle = getStyle(childSource);
    return BLOCK_LEVEL_DISPLAYS.has(childStyle.display) && isInFlow(childStyle);
  });
};

/** Marks split wrappers from a block down; a wrapper is only cut when every wrapper above it in the block is. */
const markSplitWrappers = (
  el: HTMLElement,
  sourceOf: ReadonlyMap<Element, Element>,
  getStyle: StyleGetter,
): void => {
  if (!isSplitWrapper(el, sourceOf, getStyle)) return;
  el.setAttribute(SPLIT_ATTR, '');
  const display = sourceDisplay(el, sourceOf, getStyle);
  if (display == null || !STACKING_DISPLAYS.has(display)) return;
  for (const child of Array.from(el.children)) {
    if (child instanceof HTMLElement) markSplitWrappers(child, sourceOf, getStyle);
  }
};

/** The children a split wrapper is cut between, descending through nested split wrappers. */
export function splitLeaves(block: Element): HTMLElement[] {
  return Array.from(block.children).flatMap((child): HTMLElement[] => {
    if (!(child instanceof HTMLElement)) return [];
    return child.hasAttribute(SPLIT_ATTR) ? splitLeaves(child) : [child];
  });
}

/**
 * The units a split wrapper is cut between: its leaves grouped into the vertical bands measure
 * recorded, so a line of a wrapped flex stays whole. A leaf measure never saw stands alone.
 */
export function splitUnits(block: Element): HTMLElement[][] {
  const units: HTMLElement[][] = [];
  let band: string | null = null;
  for (const leaf of splitLeaves(block)) {
    const value = leaf.getAttribute(LEAF_ATTR);
    if (value == null || value !== band) units.push([leaf]);
    else units[units.length - 1].push(leaf);
    band = value;
  }
  return units;
}

export async function captureWiki(
  source: HTMLElement,
  toStaticSvg: (wrapper: HTMLElement) => Promise<SVGSVGElement | null>,
  getStyle: StyleGetter = computedStyle,
): Promise<CapturedContent> {
  const root = source.cloneNode(true) as HTMLElement;
  // Must run before the drawio replacement and chrome removal change the clone's shape.
  const sourceOf = pairWithSource(source, root);
  // The clone has no layout, so widths come from the matching wrappers on the page.
  const sourceWrappers = outermostWrappers(source);
  const wrappers = outermostWrappers(root);
  // Sequential: each render spins up its own off-screen drawio viewer.
  for (const [i, wrapper] of wrappers.entries()) {
    await replaceDrawioWrapper(wrapper, onPageDiagramWidth(sourceWrappers[i]), toStaticSvg);
  }
  // Edit buttons exist only for logged-in viewers; anchors hash block text, so it must not depend on them.
  stripInteractiveChrome(root);
  const blocks = Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  // After chrome removal, so a wrapper's own text is judged without GROWI's buttons.
  blocks.forEach((block) => markSplitWrappers(block, sourceOf, getStyle));
  return {
    root,
    blocks,
    images: collectImages(root),
    columns: collectColumns(root, sourceOf, getStyle),
    fits: collectFits(root),
  };
}

/** `el` is a captured block, so GROWI's edit buttons are already gone. */
const isOrWrapsOnly = (el: HTMLElement, tagName: string): boolean => {
  if (el.tagName === tagName) return true;
  const children = el.children;
  return children.length === 1 && children[0].tagName === tagName;
};

const isMedia = (el: HTMLElement): boolean =>
  el.tagName === 'IMG' ||
  el.hasAttribute(DRAWIO_ATTR) ||
  ((el.textContent ?? '').trim() === '' && el.querySelector(`img, ${DRAWIO_SELECTOR}`) != null);

export function classifyBlock(el: HTMLElement): BlockKind {
  if (isOrWrapsOnly(el, 'TABLE')) return 'table';
  if (isOrWrapsOnly(el, 'PRE')) return 'code';
  if (isMedia(el)) return 'media';
  if (el.hasAttribute(SPLIT_ATTR)) return 'container';
  return 'other';
}
