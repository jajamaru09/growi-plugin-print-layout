import { BLOCK_ATTR } from '../dom-attributes';
import type { HeadingInfo, HiddenRange } from '../layout';
import { createClosedEyeIcon, createOpenEyeIcon } from './eye-icons';
import { ADD_ZONE_WIDTH_PX } from './page-break-handles';

export interface HideControlOptions {
  headings: readonly HeadingInfo[];
  outermost: readonly HiddenRange[];
  onHide(headingBlockIndex: number): void;
  onShow(headingBlockIndex: number): void;
}

const HIDE_ZONE_WIDTH_PX = 28;
const TAG_INSET_PX = 8;
const END_KEY = -1;

interface Fragment {
  el: HTMLElement;
  blockIndex: number;
  page: Element;
}

const collectFragments = (host: HTMLElement): Fragment[] =>
  Array.from(host.querySelectorAll<HTMLElement>(`[${BLOCK_ATTR}]`)).map((el) => ({
    el,
    blockIndex: Number(el.getAttribute(BLOCK_ATTR)),
    page: el.closest('.pl-page') ?? host,
  }));

/**
 * Viewport y, page frame and content left edge of a line: before `target`'s first fragment, or after the
 * last page's content.
 */
function lineGeometry(host: HTMLElement, fragments: readonly Fragment[], target: Fragment | undefined) {
  const contentOf = (page: Element): Element => page.querySelector('.pl-content') ?? page;
  if (target != null) {
    return {
      y: target.el.getBoundingClientRect().top,
      page: target.page.getBoundingClientRect(),
      contentLeft: contentOf(target.page).getBoundingClientRect().left,
    };
  }
  const pages = host.querySelectorAll('.pl-page');
  const lastPage: Element = pages[pages.length - 1] ?? fragments[fragments.length - 1]?.page ?? host;
  const content = contentOf(lastPage).getBoundingClientRect();
  return { y: content.bottom, page: lastPage.getBoundingClientRect(), contentLeft: content.left };
}

function createTag(heading: HeadingInfo | undefined, range: HiddenRange, onShow: (i: number) => void): HTMLElement {
  const label = heading?.label ?? '';
  const tag = document.createElement('span');
  tag.className = 'pl-hidden-tag';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pl-hidden-show';
  button.setAttribute('aria-label', `表示に戻す: ${label}`);
  button.appendChild(createClosedEyeIcon());
  button.addEventListener('click', () => onShow(range.headingBlockIndex));
  const text = document.createElement('span');
  text.className = 'pl-hidden-label';
  text.textContent = label;
  tag.append(button, text);
  return tag;
}

/**
 * Overlays a gray line where each outermost hidden range was taken out, and a hover button beside every
 * rendered heading to hide its section. Lives in a `.pl-ui` layer so print CSS drops it. Returns detach.
 */
export function attachHideControls(host: HTMLElement, opts: HideControlOptions): () => void {
  const layer = document.createElement('div');
  layer.className = 'pl-ui pl-hide-layer';
  const headingsByBlock = new Map(opts.headings.map((h) => [h.blockIndex, h] as const));
  let removeListeners: (() => void)[] = [];

  function buildLines(fragments: readonly Fragment[], hostRect: DOMRect): HTMLElement[] {
    const groups = new Map<number, { target: Fragment | undefined; ranges: HiddenRange[] }>();
    for (const range of [...opts.outermost].sort((a, b) => a.start - b.start)) {
      const target = fragments.find((f) => f.blockIndex >= range.end);
      const key = target?.blockIndex ?? END_KEY;
      const group = groups.get(key) ?? { target, ranges: [] };
      groups.set(key, { ...group, ranges: [...group.ranges, range] });
    }
    return Array.from(groups.values()).map(({ target, ranges }) => {
      const { y, page, contentLeft } = lineGeometry(host, fragments, target);
      const line = document.createElement('div');
      line.className = target == null ? 'pl-ui pl-hidden-line' : 'pl-ui pl-hidden-line pl-hidden-line-above';
      line.style.position = 'absolute';
      line.style.left = `${page.left - hostRect.left}px`;
      line.style.width = `${page.width}px`;
      line.style.top = `${y - hostRect.top}px`;
      // The line lands on a break boundary: the tags keep to the left half, clear of the centred "+" zone,
      // and start at the content edge, clear of the hide buttons in the left margin.
      const tags = document.createElement('div');
      tags.className = 'pl-hidden-tags';
      const inset = Math.max(TAG_INSET_PX, contentLeft - page.left);
      tags.style.marginLeft = `${inset}px`;
      tags.style.maxWidth = `${Math.max(0, page.width / 2 - ADD_ZONE_WIDTH_PX / 2 - TAG_INSET_PX - inset)}px`;
      tags.append(...ranges.map((r) => createTag(headingsByBlock.get(r.headingBlockIndex), r, opts.onShow)));
      line.appendChild(tags);
      return line;
    });
  }

  function buildHideZones(fragments: readonly Fragment[], hostRect: DOMRect): HTMLElement[] {
    const zones: HTMLElement[] = [];
    const zoneByBlock = new Map<number, HTMLElement>();
    for (const { el, blockIndex } of fragments) {
      const heading = headingsByBlock.get(blockIndex);
      if (heading == null) continue;
      let zone = zoneByBlock.get(blockIndex);
      if (zone == null) {
        zone = createHideZone(el, heading, hostRect);
        zoneByBlock.set(blockIndex, zone);
        zones.push(zone);
      }
      const target = zone;
      const enter = (): void => target.classList.add('pl-hover');
      const leave = (): void => target.classList.remove('pl-hover');
      el.addEventListener('mouseenter', enter);
      el.addEventListener('mouseleave', leave);
      removeListeners.push(() => {
        el.removeEventListener('mouseenter', enter);
        el.removeEventListener('mouseleave', leave);
      });
    }
    return zones;
  }

  function createHideZone(el: HTMLElement, heading: HeadingInfo, hostRect: DOMRect): HTMLElement {
    const rect = el.getBoundingClientRect();
    const content = el.closest('.pl-content');
    const contentLeft = content == null ? rect.left : Math.min(rect.left, content.getBoundingClientRect().left);
    const zone = document.createElement('div');
    zone.className = 'pl-ui pl-hide-zone';
    zone.style.position = 'absolute';
    zone.style.left = `${contentLeft - HIDE_ZONE_WIDTH_PX - hostRect.left}px`;
    zone.style.width = `${HIDE_ZONE_WIDTH_PX}px`;
    zone.style.top = `${rect.top - hostRect.top}px`;
    zone.style.height = `${rect.height}px`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pl-hide-button';
    button.setAttribute('aria-label', `印刷しない: ${heading.label}`);
    button.appendChild(createOpenEyeIcon());
    button.addEventListener('click', () => opts.onHide(heading.blockIndex));
    zone.appendChild(button);
    return zone;
  }

  function build(): void {
    for (const remove of removeListeners) remove();
    removeListeners = [];
    const hostRect = host.getBoundingClientRect();
    const fragments = collectFragments(host);
    layer.replaceChildren(...buildLines(fragments, hostRect), ...buildHideZones(fragments, hostRect));
  }

  build();
  host.appendChild(layer);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(build);
  observer?.observe(host);
  return () => {
    observer?.disconnect();
    for (const remove of removeListeners) remove();
    removeListeners = [];
    layer.remove();
  };
}
