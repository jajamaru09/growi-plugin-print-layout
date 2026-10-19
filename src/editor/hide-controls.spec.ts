import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { HeadingInfo, HiddenRange } from '../layout';
import { attachHideControls } from './hide-controls';
import { ADD_ZONE_WIDTH_PX } from './page-break-handles';

const rect = (top: number, height = 20, left = 0, width = 600): DOMRect => ({
  top,
  left,
  width,
  height,
  bottom: top + height,
  right: left + width,
  x: left,
  y: top,
  toJSON: () => ({}),
});

const PAGE_HEIGHT = 1000;
const PAGE_LEFT = 16;
const PAGE_WIDTH = 600;
const CONTENT_LEFT = 90;

/**
 * Each entry is one page; each number is a block fragment, 100px apart per page. Tags come from
 * `tags` (default `p`). Each page's `.pl-content` ends right after its last fragment.
 */
function buildHost(pages: number[][], tags: Record<number, string> = {}): HTMLElement {
  const host = document.createElement('div');
  host.className = 'pl-pages';
  host.getBoundingClientRect = () => rect(0, pages.length * PAGE_HEIGHT, 0, 700);
  pages.forEach((blocks, p) => {
    const page = document.createElement('div');
    page.className = 'pl-page';
    page.getBoundingClientRect = () => rect(p * PAGE_HEIGHT, PAGE_HEIGHT, PAGE_LEFT, PAGE_WIDTH);
    const body = document.createElement('div');
    body.className = 'pl-content wiki';
    body.getBoundingClientRect = () => rect(p * PAGE_HEIGHT + 50, blocks.length * 100, CONTENT_LEFT, 450);
    blocks.forEach((index, i) => {
      const block = document.createElement(tags[index] ?? 'p');
      block.setAttribute('data-pl-block', String(index));
      block.textContent = `block ${index}`;
      block.getBoundingClientRect = () => rect(p * PAGE_HEIGHT + 50 + i * 100, 20, CONTENT_LEFT, 450);
      body.appendChild(block);
    });
    page.appendChild(body);
    host.appendChild(page);
  });
  document.body.appendChild(host);
  return host;
}

const heading = (blockIndex: number, level: number, label: string): HeadingInfo => ({
  blockIndex,
  level,
  label,
  anchor: { tag: `h${level}`, textHash: '00000000', parents: [], occurrence: 0 },
});

const range = (start: number, end: number): HiddenRange => ({ start, end, headingBlockIndex: start });

const callbacks = () => ({ onHide: vi.fn(), onShow: vi.fn() });

const lines = (host: HTMLElement): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('.pl-hidden-line'));

describe('attachHideControls', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  test('each outermost range gets one gray line whose button shows the section again', () => {
    const host = buildHost([[0, 1, 4, 5]], { 0: 'h2', 4: 'h2', 5: 'h2' });
    const headings = [heading(0, 2, '序章'), heading(2, 2, '社内メモ'), heading(4, 2, '本編'), heading(5, 2, '付録')];
    const cb = callbacks();
    attachHideControls(host, { headings, outermost: [range(2, 4)], ...cb });

    const [line] = lines(host);
    expect(lines(host)).toHaveLength(1);
    expect(line.textContent).toContain('社内メモ');
    const button = line.querySelector<HTMLButtonElement>('button[aria-label="表示に戻す: 社内メモ"]');
    expect(button).not.toBeNull();
    button?.click();
    expect(cb.onShow).toHaveBeenCalledWith(2);
    expect(cb.onHide).not.toHaveBeenCalled();
  });

  test('the line sits on the first rendered block at or after the range end, spanning the page frame', () => {
    const host = buildHost([[0, 1], [4, 5]], { 0: 'h2', 4: 'h2' });
    const headings = [heading(0, 2, 'A'), heading(2, 2, 'B'), heading(4, 2, 'C')];
    attachHideControls(host, { headings, outermost: [range(2, 4)], ...callbacks() });

    const [line] = lines(host);
    // Block 4 is the first fragment of page 2: y = 1000 + 50.
    expect(line.style.top).toBe('1050px');
    expect(line.style.left).toBe(`${PAGE_LEFT}px`);
    expect(line.style.width).toBe(`${PAGE_WIDTH}px`);
  });

  test('a range at the start of the document puts its line at the top of the first page', () => {
    const host = buildHost([[3, 4]], { 3: 'h2' });
    const headings = [heading(0, 2, 'A'), heading(3, 2, 'B')];
    attachHideControls(host, { headings, outermost: [range(0, 3)], ...callbacks() });

    expect(lines(host)[0].style.top).toBe('50px');
  });

  test('a range running to the end of the document puts its line at the end of the last page content', () => {
    const host = buildHost([[0, 1], [2]], { 0: 'h2' });
    const headings = [heading(0, 2, 'A'), heading(3, 2, 'B')];
    attachHideControls(host, { headings, outermost: [range(3, 6)], ...callbacks() });

    // The last page's content starts at 1050 and holds one 100px row.
    expect(lines(host)[0].style.top).toBe('1150px');
  });

  test('tags sit above a line before a block, and keep straddling the end-of-document line', () => {
    const host = buildHost([[0, 1, 4]], { 0: 'h2', 4: 'h2' });
    const headings = [heading(0, 2, 'A'), heading(2, 2, 'B'), heading(4, 2, 'C'), heading(6, 2, 'D')];
    attachHideControls(host, { headings, outermost: [range(2, 4), range(6, 8)], ...callbacks() });

    const [beforeBlock, atEnd] = lines(host);
    expect(beforeBlock.classList.contains('pl-hidden-line-above')).toBe(true);
    expect(atEnd.classList.contains('pl-hidden-line-above')).toBe(false);
  });

  test('two outermost ranges landing at the same place share one line with a tag each', () => {
    const host = buildHost([[0, 1, 6]], { 0: 'h2', 6: 'h2' });
    const headings = [heading(0, 2, 'A'), heading(2, 2, 'B'), heading(4, 2, 'C'), heading(6, 2, 'D')];
    const cb = callbacks();
    attachHideControls(host, { headings, outermost: [range(2, 4), range(4, 6)], ...cb });

    expect(lines(host)).toHaveLength(1);
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.pl-hidden-line button'));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['表示に戻す: B', '表示に戻す: C']);
    buttons[1].click();
    expect(cb.onShow).toHaveBeenCalledWith(4);
  });

  test('the tags end before the centred add-break zone, whatever the page width', () => {
    const host = buildHost([[0, 1, 4]], { 0: 'h2', 4: 'h2' });
    const headings = [heading(0, 2, 'A'), heading(2, 2, 'とても長い見出し'.repeat(10)), heading(4, 2, 'C')];
    attachHideControls(host, { headings, outermost: [range(2, 4)], ...callbacks() });

    const tags = host.querySelector<HTMLElement>('.pl-hidden-tags') as HTMLElement;
    const right = Number.parseFloat(tags.style.marginLeft) + Number.parseFloat(tags.style.maxWidth);
    expect(right).toBeGreaterThan(0);
    expect(right).toBeLessThanOrEqual(PAGE_WIDTH / 2 - ADD_ZONE_WIDTH_PX / 2);
  });

  test('the tags start at the content edge, clear of the hide buttons in the left margin', () => {
    const host = buildHost([[0, 1, 4]], { 0: 'h2', 4: 'h2' });
    const headings = [heading(0, 2, 'A'), heading(2, 2, 'B'), heading(4, 2, 'C')];
    attachHideControls(host, { headings, outermost: [range(2, 4)], ...callbacks() });

    const tags = host.querySelector<HTMLElement>('.pl-hidden-tags') as HTMLElement;
    const line = tags.parentElement as HTMLElement;
    const tagsLeft = Number.parseFloat(line.style.left) + Number.parseFloat(tags.style.marginLeft);
    const zone = host.querySelector<HTMLElement>('.pl-hide-zone') as HTMLElement;
    const zoneRight = Number.parseFloat(zone.style.left) + Number.parseFloat(zone.style.width);
    expect(tagsLeft).toBe(CONTENT_LEFT);
    expect(tagsLeft).toBeGreaterThanOrEqual(zoneRight);
  });

  test('labels are text: markup in a heading label creates no element', () => {
    const host = buildHost([[0, 1, 4]], { 0: 'h2', 4: 'h2' });
    const evil = '<img src=x onerror=alert(1)>';
    const headings = [heading(0, 2, evil), heading(2, 2, evil), heading(4, 2, 'C')];
    attachHideControls(host, { headings, outermost: [range(2, 4)], ...callbacks() });

    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.pl-hidden-label')?.textContent).toBe(evil);
    expect(host.querySelector(`button[aria-label="表示に戻す: ${evil}"]`)).not.toBeNull();
    expect(host.querySelector(`button[aria-label="印刷しない: ${evil}"]`)).not.toBeNull();
  });

  test('every rendered heading gets one hide button, even when split across pages', () => {
    const host = buildHost([[0, 1, 2], [2, 3]], { 0: 'h1', 2: 'h2' });
    const headings = [heading(0, 1, '第1部'), heading(2, 2, '長い見出し')];
    const cb = callbacks();
    attachHideControls(host, { headings, outermost: [], ...cb });

    expect(host.querySelectorAll('button[aria-label="印刷しない: 第1部"]')).toHaveLength(1);
    const split = host.querySelectorAll<HTMLButtonElement>('button[aria-label="印刷しない: 長い見出し"]');
    expect(split).toHaveLength(1);
    split[0].click();
    expect(cb.onHide).toHaveBeenCalledWith(2);
  });

  test('blocks that are not headings get no hide button', () => {
    const host = buildHost([[0, 1, 2]], { 0: 'h2', 1: 'h3' });
    // Block 1 is an h3 element but not a heading block (e.g. inside a list in the real content).
    attachHideControls(host, { headings: [heading(0, 2, 'A')], outermost: [], ...callbacks() });

    expect(host.querySelectorAll('button[aria-label^="印刷しない"]')).toHaveLength(1);
  });

  test('the hide button sits left of the heading, outside the content area', () => {
    const host = buildHost([[0, 1]], { 0: 'h2' });
    attachHideControls(host, { headings: [heading(0, 2, 'A')], outermost: [], ...callbacks() });

    const zone = host.querySelector('button[aria-label="印刷しない: A"]')?.closest<HTMLElement>('.pl-hide-zone');
    expect(zone).not.toBeNull();
    expect(Number.parseFloat(zone?.style.left ?? '') + Number.parseFloat(zone?.style.width ?? '')).toBeLessThanOrEqual(CONTENT_LEFT);
    expect(zone?.style.top).toBe('50px');
  });

  test('hovering the heading reveals its hide button', () => {
    const host = buildHost([[0, 1]], { 0: 'h2' });
    attachHideControls(host, { headings: [heading(0, 2, 'A')], outermost: [], ...callbacks() });

    const zone = host.querySelector('.pl-hide-zone') as HTMLElement;
    const headingEl = host.querySelector('[data-pl-block="0"]') as HTMLElement;
    expect(zone.classList.contains('pl-hover')).toBe(false);
    headingEl.dispatchEvent(new MouseEvent('mouseenter'));
    expect(zone.classList.contains('pl-hover')).toBe(true);
    headingEl.dispatchEvent(new MouseEvent('mouseleave'));
    expect(zone.classList.contains('pl-hover')).toBe(false);
  });

  test('detach removes the layer', () => {
    const host = buildHost([[0, 1, 4]], { 0: 'h2', 4: 'h2' });
    const headings = [heading(0, 2, 'A'), heading(2, 2, 'B'), heading(4, 2, 'C')];
    const detach = attachHideControls(host, { headings, outermost: [range(2, 4)], ...callbacks() });
    expect(host.querySelectorAll('.pl-ui')).not.toHaveLength(0);
    detach();
    expect(host.querySelectorAll('.pl-ui')).toHaveLength(0);
  });
});
