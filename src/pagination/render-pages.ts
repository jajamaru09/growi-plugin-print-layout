import type { CapturedContent } from '../capture';
import { classifyBlock, splitUnits } from '../capture';
import { mmToPx } from '../constants';
import { BLOCK_ATTR, COLUMNS_ATTR, FIT_ATTR, IMAGE_ATTR, SCALE_ATTR, SPLIT_ATTR } from '../dom-attributes';
import type { PageSetup } from '../layout';
import { forEachCounterpart } from './counterparts';
import { lineStartOffsets, locateTextOffset } from './measure-math';
import type { Page, Placement } from './paginate';

export function pageFrameSizeMm(setup: PageSetup): { widthMm: number; heightMm: number } {
  return setup.orientation === 'landscape'
    ? { widthMm: setup.heightMm, heightMm: setup.widthMm }
    : { widthMm: setup.widthMm, heightMm: setup.heightMm };
}

export function contentBoxPx(setup: PageSetup): { widthPx: number; heightPx: number } {
  const { widthMm, heightMm } = pageFrameSizeMm(setup);
  const { top, bottom, left, right } = setup.margin;
  return { widthPx: mmToPx(widthMm - left - right), heightPx: mmToPx(heightMm - top - bottom) };
}

type Range = { start: number; end: number };

/** Scale a `.pl-scaled` wrapper applies to `el` (1 when it is not inside one). */
export function readScale(el: Element): number {
  const scale = Number(el.closest(`[${SCALE_ATTR}]`)?.getAttribute(SCALE_ATTR));
  return scale > 0 ? scale : 1;
}

/** Captured element -> [attribute, value] to put on its rendered clones. */
type CloneTags = ReadonlyMap<Element, readonly [string, string]>;

const cloneTagsOf = (content: CapturedContent): CloneTags =>
  new Map<Element, readonly [string, string]>([
    ...content.images.map(({ element }, i) => [element, [IMAGE_ATTR, String(i)]] as const),
    ...content.columns.map(({ element }, i) => [element, [COLUMNS_ATTR, String(i)]] as const),
    ...content.fits.map(({ element }, i) => [element, [FIT_ATTR, String(i)]] as const),
  ]);

/** Tags the clone's counterparts of images, columns and fit targets. */
const tagClone = (source: HTMLElement, clone: HTMLElement, tags: CloneTags): void => {
  forEachCounterpart(source, clone, (sourceEl, cloneEl) => {
    const tag = tags.get(sourceEl);
    if (tag !== undefined) cloneEl.setAttribute(tag[0], tag[1]);
  });
};

const keepTableRows = (block: HTMLElement, range: Range): void => {
  const table = block.tagName === 'TABLE' ? block : block.querySelector('table');
  if (table == null) return;
  Array.from(table.querySelectorAll(':scope > tbody > tr')).forEach((row, i) => {
    if (i < range.start || i >= range.end) row.remove();
  });
};

const textNodesOf = (el: Element): Text[] => {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n != null; n = walker.nextNode()) nodes.push(n as Text);
  return nodes;
};

/**
 * Replaces the code's children with lines [start, end), cut with a Range so
 * the highlight spans around the cut survive.
 */
const keepCodeLines = (block: HTMLElement, range: Range): void => {
  const pre = block.tagName === 'PRE' ? block : block.querySelector('pre');
  if (pre == null) return;
  const code = pre.querySelector('code') ?? pre;
  const nodes = textNodesOf(code);
  const lengths = nodes.map((n) => n.data.length);
  const text = nodes.map((n) => n.data).join('');
  const starts = lineStartOffsets(text);
  if (range.start === 0 && range.end >= starts.length) return;

  const from = locateTextOffset(lengths, starts[range.start] ?? text.length);
  const to = locateTextOffset(lengths, starts[range.end] ?? text.length);
  const cut = code.ownerDocument.createRange();
  cut.setStart(nodes[from.segment], from.offset);
  cut.setEnd(nodes[to.segment], to.offset);

  let lines: Node = cut.cloneContents();
  // cloneContents drops the ancestors shared by both ends (e.g. one span holding the whole cut).
  for (let n: Node | null = cut.commonAncestorContainer; n != null && n !== code; n = n.parentNode) {
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const shell = n.cloneNode(false);
    shell.appendChild(lines);
    lines = shell;
  }
  code.replaceChildren(lines);
};

/** Keeps bands [start, end) of a split wrapper and drops the nested wrappers left empty. */
const keepLeaves = (block: HTMLElement, range: Range): void => {
  const units = splitUnits(block);
  units.forEach((leaves, i) => {
    if (i < range.start || i >= range.end) leaves.forEach((leaf) => leaf.remove());
  });
  // Deepest first, so a wrapper that only held emptied wrappers goes too.
  Array.from(block.querySelectorAll(`[${SPLIT_ATTR}]`))
    .reverse()
    .forEach((wrapper) => {
      if (wrapper.childElementCount === 0) wrapper.remove();
    });
  // A band's extent starts at its border box; its top margin was measured with the band above.
  if (range.start > 0) {
    units[range.start]?.forEach((leaf) => {
      leaf.style.marginTop = '0px';
    });
  }
};

const cloneBlock = (
  content: CapturedContent,
  placement: Placement,
  tags: CloneTags,
): HTMLElement => {
  const source = content.blocks[placement.blockIndex];
  const clone = source.cloneNode(true) as HTMLElement;
  tagClone(source, clone, tags);
  const kind = classifyBlock(source);
  if (placement.unitRange != null && kind === 'table') keepTableRows(clone, placement.unitRange);
  if (placement.unitRange != null && kind === 'code') keepCodeLines(clone, placement.unitRange);
  if (placement.unitRange != null && kind === 'container') keepLeaves(clone, placement.unitRange);
  clone.setAttribute(BLOCK_ATTR, String(placement.blockIndex));
  return clone;
};

/** paginate scales a placement to fill the content box exactly, so that is its visual height. */
const wrapScaled = (block: HTMLElement, scale: number, contentHeightPx: number): HTMLElement => {
  const outer = document.createElement('div');
  outer.className = 'pl-scaled';
  outer.style.height = `${contentHeightPx}px`;
  outer.style.overflow = 'hidden';
  const inner = document.createElement('div');
  inner.style.display = 'flow-root';
  inner.style.transform = `scale(${scale})`;
  inner.setAttribute(SCALE_ATTR, String(scale));
  inner.style.transformOrigin = 'top left';
  inner.appendChild(block);
  outer.appendChild(inner);
  return outer;
};

const createPageFrame = (setup: PageSetup): HTMLDivElement => {
  const { widthMm, heightMm } = pageFrameSizeMm(setup);
  const { top, right, bottom, left } = setup.margin;
  const frame = document.createElement('div');
  frame.className = 'pl-page';
  frame.style.boxSizing = 'border-box';
  frame.style.width = `${widthMm}mm`;
  frame.style.height = `${heightMm}mm`;
  frame.style.paddingTop = `${top}mm`;
  frame.style.paddingRight = `${right}mm`;
  frame.style.paddingBottom = `${bottom}mm`;
  frame.style.paddingLeft = `${left}mm`;
  frame.style.overflow = 'hidden';
  frame.style.background = '#fff';
  return frame;
};

/**
 * Fills `host` with one `.pl-page` per page; the final one also gets `.pl-page-last`. The content box mirrors the
 * measuring host of measureBlocks (same classes, width and flow-root).
 */
export function renderPages(
  host: HTMLElement,
  content: CapturedContent,
  pages: readonly Page[],
  setup: PageSetup,
): HTMLElement[] {
  const tags = cloneTagsOf(content);
  const { heightPx } = contentBoxPx(setup);
  const frames = pages.map((page) => {
    const frame = createPageFrame(setup);
    const body = document.createElement('div');
    body.className = content.root.className;
    body.classList.add('pl-content', 'wiki');
    body.style.display = 'flow-root';
    page.placements.forEach((placement, i) => {
      const block = cloneBlock(content, placement, tags);
      // The measured height of a block excludes its own top margin, so it must not push the page.
      if (i === 0 || placement.scale !== undefined) block.style.marginTop = '0px';
      body.appendChild(placement.scale !== undefined ? wrapScaled(block, placement.scale, heightPx) : block);
    });
    frame.appendChild(body);
    return frame;
  });
  // Overlay layers are appended after the frames, so print CSS cannot use :last-child.
  frames[frames.length - 1]?.classList.add('pl-page-last');
  host.replaceChildren(...frames);
  return frames;
}
