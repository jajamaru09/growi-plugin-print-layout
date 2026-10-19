import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CapturedContent } from '../capture';
import { FIT_CLASS, FIT_WRAP_CLASS, fitOverflow } from './fit';

/*
 * jsdom has no layout, so widths come from attributes on the laid-out clones:
 * `data-natural` is an element's own content width (`data-wrapped` while it has the wrap class,
 * `data-zoomed` while it is zoomed out, in its own unzoomed pixels), and its scrollWidth also takes in its
 * descendants' (the fit rules make every fitted subtree overflow visibly) and is 0 while it is
 * not rendered. An element with `data-available`
 * is a container whose width is that value, or grows to fit its widest visible child
 * (at its zoom) the way a flex item grows to its min-content.
 */
const isZoomed = (el: Element): boolean => el instanceof HTMLElement && el.style.zoom !== '' && Number(el.style.zoom) < 1;

const naturalOf = (el: Element): number =>
  Number(
    (isZoomed(el) && el.getAttribute('data-zoomed')) ||
      (el.classList.contains(FIT_WRAP_CLASS) && el.getAttribute('data-wrapped')) ||
      el.getAttribute('data-natural') ||
      0,
  );

const rect = (width: number): DOMRect => ({
  x: 0,
  y: 0,
  width,
  height: 10,
  top: 0,
  left: 0,
  right: width,
  bottom: 10,
  toJSON: () => ({}),
});

const scrollWidthOf = (el: Element): number =>
  getComputedStyle(el).display === 'none'
    ? 0
    : Math.max(naturalOf(el), ...Array.from(el.children).map(scrollWidthOf));

beforeEach(() => {
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
    return scrollWidthOf(this);
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const available = Number(this.getAttribute('data-available') ?? 0);
    if (available === 0) return rect(0);
    const visible = Array.from(this.children).filter((c) => !(c instanceof HTMLElement && c.style.display === 'none'));
    const widths = visible.map((c) => naturalOf(c) * (c instanceof HTMLElement ? Number(c.style.zoom) || 1 : 1));
    return rect(Math.max(available, ...widths));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const TABLE = '<table class="target" data-natural="800"><tbody><tr><td>a<table><tr><td>n</td></tr></table></td></tr></tbody></table>';
const CODE = '<pre class="target" data-natural="300"><div><code data-natural="300">x</code></div></pre>';

const makeContent = (html: string): CapturedContent => {
  const root = document.createElement('div');
  root.className = 'wiki';
  root.innerHTML = html;
  const fits = Array.from(root.querySelectorAll<HTMLElement>('.target')).map((element) => ({
    element,
    kind: element.tagName === 'TABLE' ? ('table' as const) : ('code' as const),
  }));
  return { root, blocks: Array.from(root.children) as HTMLElement[], images: [], columns: [], fits };
};

const twoTargets = (): CapturedContent =>
  makeContent(`<div data-available="400">${TABLE}</div><p>p</p><div data-available="400">${CODE}</div>`);

describe('fitOverflow', () => {
  test('marks every target fitted, and wraps all but the shrink-only ones', async () => {
    const content = twoTargets();
    await fitOverflow(content, { 1: { mode: 'shrink' } }, 400);
    const [table, pre] = content.fits.map((f) => f.element);
    expect(table.classList.contains(FIT_CLASS)).toBe(true);
    expect(table.classList.contains(FIT_WRAP_CLASS)).toBe(true);
    expect(pre.classList.contains(FIT_CLASS)).toBe(true);
    expect(pre.classList.contains(FIT_WRAP_CLASS)).toBe(false);
    expect(table.querySelector('table')?.className).toBe('');
  });

  test('zooms a target that is wider than its container, measured with the target taken out of flow', async () => {
    const content = twoTargets();
    const results = await fitOverflow(content, {}, 400);
    const [table, pre] = content.fits.map((f) => f.element);
    expect(table.style.zoom).toBe('0.5');
    expect(pre.style.zoom).toBe('');
    expect(results).toEqual([
      { index: 0, kind: 'table', mode: 'auto', scale: 0.5, warning: 'small' },
      { index: 1, kind: 'code', mode: 'auto', scale: 1, warning: null },
    ]);
  });

  // Word-boundary wrapping leaves a many-column table, or a line with one long token, wider than its container.
  test('shrinks a target by the width it has once wrapped, and by its unwrapped width when shrink-only', async () => {
    const html = '<div data-available="400"><table class="target" data-natural="1000" data-wrapped="600"></table></div>';
    const [auto] = await fitOverflow(makeContent(html), {}, 400);
    const [shrink] = await fitOverflow(makeContent(html), { 0: { mode: 'shrink' } }, 400);
    expect(auto).toMatchObject({ scale: 0.66, warning: null });
    expect(shrink).toMatchObject({ scale: 0.4, warning: 'small' });
  });

  test('a target that fits once wrapped is not shrunk', async () => {
    const content = makeContent('<div data-available="400"><pre class="target" data-natural="1000" data-wrapped="400"></pre></div>');
    const [result] = await fitOverflow(content, {}, 400);
    expect(result).toMatchObject({ scale: 1, warning: null });
    expect(content.fits[0].element.style.zoom).toBe('');
  });

  // Glyph widths and borders round at a zoom, so a table at its min-content can lay out wider than scale x natural.
  test('steps a zoomed target down until it really fits, and reports the scale it ends at', async () => {
    const content = makeContent(
      '<div data-available="643"><table class="target" data-natural="1236" data-zoomed="1241"></table></div>',
    );
    const [result] = await fitOverflow(content, {}, 643);
    expect(result).toMatchObject({ scale: 0.51, warning: 'small' });
    expect(content.fits[0].element.style.zoom).toBe('0.51');
  });

  test('a target that stays too wide through every step down is flagged, not clipped silently', async () => {
    const content = makeContent(
      '<div data-available="643"><table class="target" data-natural="1000" data-zoomed="1000000"></table></div>',
    );
    const [result] = await fitOverflow(content, {}, 643);
    expect(result.warning).toBe('overflow');
  });

  test('a fixed scale is kept, but warns when the target laid out at it is still too wide', async () => {
    const content = makeContent(
      '<div data-available="400"><table class="target" data-natural="500" data-zoomed="520"></table></div>',
    );
    const [result] = await fitOverflow(content, { 0: { mode: 'scale', scalePercent: 80 } }, 400);
    expect(result).toMatchObject({ scale: 0.8, warning: 'overflow' });
    expect(content.fits[0].element.style.zoom).toBe('0.8');
  });

  test('a code block whose wide lines sit in an inner box is still as wide as them', async () => {
    const content = makeContent(
      '<div data-available="400"><pre class="target" data-natural="300"><div data-natural="1000"><code>x</code></div></pre></div>',
    );
    const [result] = await fitOverflow(content, {}, 400);
    expect(result.scale).toBe(0.4);
    expect(content.fits[0].element.style.zoom).toBe('0.4');
  });

  test('reports the mode, the fixed scale and its overflow warning per target', async () => {
    const content = twoTargets();
    const results = await fitOverflow(content, { 0: { mode: 'scale', scalePercent: 80 }, 1: { mode: 'shrink' } }, 400);
    expect(results).toEqual([
      { index: 0, kind: 'table', mode: 'scale', scale: 0.8, warning: 'overflow' },
      { index: 1, kind: 'code', mode: 'shrink', scale: 1, warning: null },
    ]);
    expect(content.fits[0].element.style.zoom).toBe('0.8');
  });

  test('a later run clears the wrap class and zoom left by an earlier one', async () => {
    const content = twoTargets();
    await fitOverflow(content, {}, 400);
    const pre = content.fits[1].element;
    pre.style.zoom = '0.5';
    const table = content.fits[0].element;
    table.setAttribute('data-natural', '300');
    await fitOverflow(content, { 1: { mode: 'shrink' } }, 400);
    expect(table.style.zoom).toBe('');
    expect(pre.style.zoom).toBe('');
    expect(pre.classList.contains(FIT_WRAP_CLASS)).toBe(false);
  });

  test('each target is back in flow when its own width is measured', async () => {
    const content = makeContent(
      '<div data-available="400"><table class="target" style="display: table;" data-natural="800"></table><pre class="target" data-natural="300"></pre></div>',
    );
    const results = await fitOverflow(content, {}, 400);
    expect(results.map((r) => r.scale)).toEqual([0.5, 1]);
  });

  test("a target's own border counts toward its width", async () => {
    const content = makeContent(
      '<div data-available="400"><table class="target" style="border: 10px solid black;" data-natural="800"></table></div>',
    );
    const [result] = await fitOverflow(content, {}, 400);
    expect(result.scale).toBe(0.48);
  });

  test('a container without a box of its own is measured by its nearest ancestor that has one', async () => {
    const content = makeContent(`<div data-available="400"><div>${TABLE}</div></div>`);
    const [result] = await fitOverflow(content, {}, 400);
    expect(result.scale).toBe(0.5);
  });

  test('a target whose container cannot be measured is left as is but flagged', async () => {
    const content = makeContent(`<div>${TABLE}</div>`);
    const [result] = await fitOverflow(content, {}, 400);
    expect(result).toMatchObject({ scale: 1, warning: 'overflow' });
  });

  test('wide targets sharing a column do not hold it open for each other', async () => {
    const content = makeContent(
      '<div data-available="300"><pre class="target" data-natural="900"></pre><table class="target" data-natural="800"></table></div>',
    );
    const results = await fitOverflow(content, { 0: { mode: 'shrink' } }, 400);
    expect(results.map((r) => r.scale)).toEqual([0.33, 0.37]);
  });

  test('removes its off-screen host, and does not lay anything out without targets', async () => {
    const before = document.body.childElementCount;
    await fitOverflow(twoTargets(), {}, 400);
    expect(document.body.childElementCount).toBe(before);

    const appended = vi.spyOn(document.body, 'appendChild');
    const none = makeContent('<p>a</p><p><img src="/x.png"></p>');
    expect(await fitOverflow(none, {}, 400)).toEqual([]);
    expect(appended).not.toHaveBeenCalled();
  });

  test('a run superseded while waiting for assets does not write onto the content', async () => {
    const content = makeContent(`<div data-available="400">${TABLE}</div><p><img src="/x.png"></p>`);
    const resolvers: (() => void)[] = [];
    const proto = HTMLImageElement.prototype as { decode?: () => Promise<void> };
    proto.decode = () => new Promise<void>((resolve) => resolvers.push(resolve));
    try {
      const older = fitOverflow(content, {}, 400);
      const newer = fitOverflow(content, { 0: { mode: 'scale', scalePercent: 90 } }, 400);
      expect(resolvers).toHaveLength(2);
      resolvers[1]();
      await newer;
      resolvers[0]();
      await older;
      expect(content.fits[0].element.style.zoom).toBe('0.9');
    } finally {
      delete proto.decode;
    }
  });
});
