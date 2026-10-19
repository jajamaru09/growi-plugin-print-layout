import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FitResult } from '../pagination';
import { attachFitBadges, fitBadgeText } from './fit-badges';

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
});

const result = (over: Partial<FitResult> = {}): FitResult => ({
  index: 0, kind: 'table', mode: 'auto', scale: 1, warning: null, ...over,
});

/** One fit target per entry of `indexes` (a repeated index is a split table's second fragment). */
function buildHost(indexes: number[] = [0]): HTMLElement {
  const host = document.createElement('div');
  host.getBoundingClientRect = () => rect(0, 0, 800, 1000);
  const content = document.createElement('div');
  content.className = 'pl-content';
  content.getBoundingClientRect = () => rect(100, 0, 600, 1000);
  indexes.forEach((index, i) => {
    const el = document.createElement('table');
    el.setAttribute('data-pl-fit', String(index));
    el.getBoundingClientRect = () => rect(100, 50 + i * 300, 500, 200);
    content.appendChild(el);
  });
  host.appendChild(content);
  document.body.appendChild(host);
  return host;
}

const badges = (host: HTMLElement): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('.pl-fit-badge'));
const menuOf = (host: HTMLElement): HTMLElement | null => host.querySelector<HTMLElement>('.pl-fit-menu');
const radio = (host: HTMLElement, label: string): HTMLInputElement => {
  const found = Array.from(host.querySelectorAll('.pl-fit-menu label')).find((l) => l.textContent?.trim() === label);
  const input = found?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`no radio ${label}`);
  return input;
};
const open = (host: HTMLElement): void => {
  badges(host)[0].click();
};
const attach = (host: HTMLElement, fits: FitResult[], overrides = {}, openMenu: number | null = null) => {
  const onChange = vi.fn();
  const onMenuChange = vi.fn();
  const detach = attachFitBadges(host, { fits, overrides, onChange, openMenu, onMenuChange });
  return { onChange, onMenuChange, detach };
};

describe('fitBadgeText', () => {
  test.each([
    [result(), '自動'],
    [result({ scale: 0.66 }), '自動・縮小 66%'],
    [result({ mode: 'shrink', scale: 0.4 }), '縮小のみ 40%'],
    [result({ mode: 'scale', scale: 0.8 }), '倍率 80%'],
  ])('%j reads %s', (r, text) => {
    expect(fitBadgeText(r)).toBe(text);
  });
});

describe('attachFitBadges', () => {
  beforeEach(() => document.body.replaceChildren());
  afterEach(() => document.body.replaceChildren());

  test('shows one badge per rendered fragment, labelled from its fit result, in the .pl-ui layer', () => {
    const host = buildHost([0, 0, 1]);
    attach(host, [result({ scale: 0.5 }), result({ index: 1, kind: 'code' })]);
    expect(badges(host).map((b) => b.textContent)).toEqual(['自動・縮小 50%', '自動・縮小 50%', '自動']);
    expect(badges(host).every((b) => b.closest('.pl-ui') != null)).toBe(true);
  });

  test('a badge sits at the top-right corner of its element, from visual rects', () => {
    const host = buildHost();
    attach(host, [result()]);
    const style = badges(host)[0].style;
    expect(style.left).toBe('600px');
    expect(style.top).toBe('50px');
  });

  test('an element cut off at the right of its page keeps its badge at the right edge of the page content', () => {
    const host = buildHost();
    const target = host.querySelector<HTMLElement>('[data-pl-fit]') as HTMLElement;
    target.getBoundingClientRect = () => rect(100, 50, 1200, 200);
    attach(host, [result({ mode: 'scale', warning: 'overflow' })]);
    expect([badges(host)[0].style.left, badges(host)[0].style.top]).toEqual(['700px', '50px']);
    open(host);
    expect(menuOf(host)?.style.left).toBe('700px');
  });

  test('a warning adds pl-fit-badge-warn', () => {
    const host = buildHost([0, 1]);
    attach(host, [result({ warning: 'small', scale: 0.5 }), result({ index: 1 })]);
    expect(badges(host).map((b) => b.classList.contains('pl-fit-badge-warn'))).toEqual([true, false]);
  });

  test('clicking a badge opens a menu with three options, the current one checked', () => {
    const host = buildHost();
    attach(host, [result({ mode: 'shrink', scale: 0.5 })], { 0: { mode: 'shrink' } });
    open(host);
    expect(Array.from(host.querySelectorAll('.pl-fit-menu label')).map((l) => l.textContent?.trim())).toEqual(['自動', '縮小のみ', '倍率を指定']);
    expect(radio(host, '縮小のみ').checked).toBe(true);
    expect(host.querySelector('.pl-fit-menu select')).toBeNull();
    expect(menuOf(host)?.classList.contains('pl-ui')).toBe(true);
  });

  test('choosing 縮小のみ commits shrink and closes the menu', () => {
    const host = buildHost();
    const { onChange } = attach(host, [result()]);
    open(host);
    radio(host, '縮小のみ').click();
    expect(onChange.mock.calls).toEqual([[0, { mode: 'shrink' }]]);
    expect(menuOf(host)).toBeNull();
  });

  test('choosing 自動 on an overridden target commits null', () => {
    const host = buildHost();
    const { onChange } = attach(host, [result({ mode: 'shrink' })], { 0: { mode: 'shrink' } });
    open(host);
    radio(host, '自動').click();
    expect(onChange.mock.calls).toEqual([[0, null]]);
  });

  test('choosing 倍率を指定 commits the computed scale rounded down to the step and keeps the menu open on its select', () => {
    const host = buildHost();
    const { onChange, onMenuChange } = attach(host, [result({ scale: 0.66 })]);
    open(host);
    radio(host, '倍率を指定').click();
    expect(onChange.mock.calls).toEqual([[0, { mode: 'scale', scalePercent: 65 }]]);
    expect(radio(host, '倍率を指定').checked).toBe(true);
    const select = host.querySelector<HTMLSelectElement>('.pl-fit-menu select') as HTMLSelectElement;
    expect(select.value).toBe('65');
    expect(onMenuChange).toHaveBeenLastCalledWith(0);
    select.value = '80';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange.mock.calls[1]).toEqual([0, { mode: 'scale', scalePercent: 80 }]);
    expect(menuOf(host)).toBeNull();
    expect(onMenuChange).toHaveBeenLastCalledWith(null);
  });

  // The preview re-attaches the badges after every change, so the open menu has to survive that.
  test('a menu asked for on attach opens at the first fragment of that target', () => {
    const host = buildHost([0, 1, 1]);
    attach(host, [result(), result({ index: 1, mode: 'scale', scale: 0.7 })], { 1: { mode: 'scale', scalePercent: 70 } }, 1);
    expect(menuOf(host)?.style.top).toBe(`${350 + 24}px`);
    expect(radio(host, '倍率を指定').checked).toBe(true);
  });

  test('a menu asked for on a target that is not rendered opens nothing', () => {
    const host = buildHost();
    attach(host, [result()], {}, 5);
    expect(menuOf(host)).toBeNull();
  });

  test('reports which menu is open, and null when it closes', () => {
    const host = buildHost();
    const { onMenuChange } = attach(host, [result()]);
    open(host);
    expect(onMenuChange).toHaveBeenLastCalledWith(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onMenuChange).toHaveBeenLastCalledWith(null);
    open(host);
    radio(host, '縮小のみ').click();
    expect(onMenuChange).toHaveBeenLastCalledWith(null);
  });

  test('a saved scale off the 5% step is offered as its own option and shown selected', () => {
    const host = buildHost();
    attach(host, [result({ mode: 'scale', scale: 0.72 })], { 0: { mode: 'scale', scalePercent: 72 } });
    open(host);
    const select = host.querySelector<HTMLSelectElement>('.pl-fit-menu select') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(
      ['50', '55', '60', '65', '70', '72', '75', '80', '85', '90', '95', '100'],
    );
    expect(select.value).toBe('72');
  });

  test('the default scale never drops below 50', () => {
    const host = buildHost();
    const { onChange } = attach(host, [result({ scale: 0.3 })]);
    open(host);
    radio(host, '倍率を指定').click();
    expect(onChange.mock.calls).toEqual([[0, { mode: 'scale', scalePercent: 50 }]]);
  });

  test('when 倍率を指定 is active the menu shows a 50..100 step 5 select with the saved value; changing it commits', () => {
    const host = buildHost();
    const { onChange } = attach(host, [result({ mode: 'scale', scale: 0.7 })], { 0: { mode: 'scale', scalePercent: 70 } });
    open(host);
    const select = host.querySelector<HTMLSelectElement>('.pl-fit-menu select') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(
      ['50', '55', '60', '65', '70', '75', '80', '85', '90', '95', '100'],
    );
    expect(select.value).toBe('70');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
    select.value = '80';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange.mock.calls).toEqual([[0, { mode: 'scale', scalePercent: 80 }]]);
    expect(menuOf(host)).toBeNull();
  });

  test('no select is shown while another option is active', () => {
    const host = buildHost();
    attach(host, [result()]);
    open(host);
    expect(host.querySelector('.pl-fit-menu select')).toBeNull();
  });

  test('choosing 自動 on an auto target commits nothing', () => {
    const host = buildHost();
    const { onChange } = attach(host, [result()]);
    open(host);
    radio(host, '自動').click();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('Escape and an outside click close the menu without a change', () => {
    const host = buildHost();
    const { onChange } = attach(host, [result()]);
    open(host);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menuOf(host)).toBeNull();
    open(host);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(menuOf(host)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('clicking the same badge again closes the menu', () => {
    const host = buildHost();
    attach(host, [result()]);
    open(host);
    open(host);
    expect(menuOf(host)).toBeNull();
  });

  test('detach removes every badge and the menu, drops the document listeners and disconnects the observer', () => {
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = disconnect; });
    const removed = vi.spyOn(document, 'removeEventListener');
    const host = buildHost([0, 0]);
    const { detach } = attach(host, [result()]);
    open(host);
    detach();
    expect(host.querySelector('.pl-ui')).toBeNull();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(removed.mock.calls.map(([type]) => type).sort()).toEqual(['keydown', 'pointerdown']);
    vi.unstubAllGlobals();
    removed.mockRestore();
  });

  test('a resize repositions badges and the open menu from fresh rects', () => {
    let notify: () => void = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { notify = cb; }
      observe = vi.fn();
      disconnect = vi.fn();
    });
    const host = buildHost();
    attach(host, [result()]);
    open(host);
    const target = host.querySelector('table') as HTMLElement;
    target.getBoundingClientRect = () => rect(200, 80, 500, 200);
    notify();
    expect([badges(host)[0].style.left, badges(host)[0].style.top]).toEqual(['700px', '80px']);
    expect([menuOf(host)?.style.left, menuOf(host)?.style.top]).toEqual(['700px', '104px']);
    vi.unstubAllGlobals();
  });
});
