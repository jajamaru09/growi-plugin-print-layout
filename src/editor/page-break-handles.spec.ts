import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { attachPageBreakHandles } from './page-break-handles';

const rect = (top: number): DOMRect => ({ top, left: 0, width: 600, height: 20, bottom: top + 20, right: 600, x: 0, y: top, toJSON: () => ({}) });

/** Each entry is one page; each number is a block fragment, 100px apart per page. */
function buildHost(pages: number[][]): HTMLElement {
  const host = document.createElement('div');
  host.getBoundingClientRect = () => rect(0);
  pages.forEach((blocks, p) => {
    const page = document.createElement('div');
    page.className = 'pl-page';
    page.getBoundingClientRect = () => rect(p * 1000);
    blocks.forEach((index, i) => {
      const block = document.createElement('p');
      block.setAttribute('data-pl-block', String(index));
      block.getBoundingClientRect = () => rect(p * 1000 + i * 100);
      page.appendChild(block);
    });
    host.appendChild(page);
  });
  document.body.appendChild(host);
  return host;
}

const handlers = () => ({ onAdd: vi.fn(), onMove: vi.fn(), onRemove: vi.fn() });
const fire = (target: EventTarget, type: string, clientY = 0): void => {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY, button: 0 }));
};

describe('attachPageBreakHandles', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  test('clicking the "+" between block 2 and 3 calls onAdd(3)', () => {
    const host = buildHost([[0, 1, 2, 3]]);
    const h = handlers();
    attachPageBreakHandles(host, new Set(), h);
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.pl-break-add-button'));
    expect(buttons).toHaveLength(3);
    buttons[2].click();
    expect(h.onAdd).toHaveBeenCalledWith(3);
  });

  test('no "+" is offered before block 0 or inside a split block', () => {
    const host = buildHost([[0, 1, 1], [1, 2]]);
    const h = handlers();
    attachPageBreakHandles(host, new Set(), h);
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.pl-break-add-button'));
    expect(buttons).toHaveLength(2);
    buttons[0].click();
    buttons[1].click();
    expect(h.onAdd.mock.calls).toEqual([[1], [2]]);
  });

  test('clicking × on a manual break at block 5 calls onRemove(5)', () => {
    const host = buildHost([[3, 4], [5, 6]]);
    const h = handlers();
    attachPageBreakHandles(host, new Set([5]), h);
    host.querySelector<HTMLButtonElement>('[data-pl-break="5"] .pl-break-remove')?.click();
    expect(h.onRemove).toHaveBeenCalledWith(5);
  });

  test('pointerdown on break 5, pointerup nearest boundary of block 8 calls onMove(5, 8)', () => {
    const host = buildHost([[3, 4], [5, 6], [7, 8, 9]]);
    const h = handlers();
    attachPageBreakHandles(host, new Set([5]), h);
    const line = host.querySelector('[data-pl-break="5"]') as HTMLElement;
    fire(line, 'pointerdown', 1000);
    fire(document, 'pointermove', 2050);
    fire(document, 'pointerup', 2090);
    expect(h.onMove).toHaveBeenCalledWith(5, 8);
  });

  test('dropping nearest its own boundary does not move', () => {
    const host = buildHost([[3, 4], [5, 6]]);
    const h = handlers();
    attachPageBreakHandles(host, new Set([5]), h);
    fire(host.querySelector('[data-pl-break="5"]') as HTMLElement, 'pointerdown', 1000);
    fire(document, 'pointerup', 1010);
    expect(h.onMove).not.toHaveBeenCalled();
  });

  test('auto page starts get a thin line, manual ones do not', () => {
    const host = buildHost([[0, 1], [2, 3], [4]]);
    attachPageBreakHandles(host, new Set([4]), handlers());
    expect(host.querySelectorAll('.pl-auto-break')).toHaveLength(1);
    expect(host.querySelectorAll('.pl-manual-break')).toHaveLength(1);
  });

  test('detach removes all .pl-ui handles and listeners', () => {
    const host = buildHost([[0, 1], [2, 3]]);
    const h = handlers();
    const detach = attachPageBreakHandles(host, new Set([2]), h);
    const line = host.querySelector('[data-pl-break="2"]') as HTMLElement;
    fire(line, 'pointerdown', 1000);
    detach();
    expect(host.querySelectorAll('.pl-ui')).toHaveLength(0);
    fire(document, 'pointerup', 0);
    expect(h.onMove).not.toHaveBeenCalled();
  });

  test('geometry is re-read at drop: a scroll during the drag still picks the right block', () => {
    const host = buildHost([[3, 4], [5, 6], [7, 8]]);
    const h = handlers();
    attachPageBreakHandles(host, new Set([5]), h);
    fire(host.querySelector('[data-pl-break="5"]') as HTMLElement, 'pointerdown', 1000);
    // Scroll by 1000px: block 7 now sits at y=1000, block 8 at y=1100.
    host.querySelectorAll<HTMLElement>('[data-pl-block]').forEach((el) => {
      const top = el.getBoundingClientRect().top - 1000;
      el.getBoundingClientRect = () => rect(top);
    });
    fire(document, 'pointerup', 1090);
    expect(h.onMove).toHaveBeenCalledWith(5, 8);
  });

  test('pointerdown on × does not start a drag', () => {
    const host = buildHost([[3, 4], [5, 6], [7, 8]]);
    const h = handlers();
    attachPageBreakHandles(host, new Set([5]), h);
    fire(host.querySelector('[data-pl-break="5"] .pl-break-remove') as HTMLElement, 'pointerdown', 1000);
    fire(document, 'pointerup', 2000);
    expect(h.onMove).not.toHaveBeenCalled();
  });

  test('dropping nearest another manual break does not move', () => {
    const host = buildHost([[3, 4], [5, 6], [7, 8]]);
    const h = handlers();
    attachPageBreakHandles(host, new Set([5, 7]), h);
    fire(host.querySelector('[data-pl-break="5"]') as HTMLElement, 'pointerdown', 1000);
    fire(document, 'pointerup', 2000);
    expect(h.onMove).not.toHaveBeenCalled();
  });

  test('pointercancel restores the line position', () => {
    const host = buildHost([[3, 4], [5, 6]]);
    const h = handlers();
    attachPageBreakHandles(host, new Set([5]), h);
    const line = host.querySelector('[data-pl-break="5"]') as HTMLElement;
    const original = line.style.top;
    fire(line, 'pointerdown', 1000);
    fire(document, 'pointermove', 1500);
    expect(line.style.top).not.toBe(original);
    fire(document, 'pointercancel');
    expect(line.style.top).toBe(original);
    expect(h.onMove).not.toHaveBeenCalled();
  });

  test('dragging near the container edge scrolls it', () => {
    const container = document.createElement('main');
    container.className = 'pl-preview';
    container.getBoundingClientRect = () => ({ ...rect(0), height: 500, bottom: 500 });
    const host = buildHost([[3, 4], [5, 6]]);
    container.appendChild(host);
    document.body.appendChild(container);
    attachPageBreakHandles(host, new Set([5]), handlers());
    fire(host.querySelector('[data-pl-break="5"]') as HTMLElement, 'pointerdown', 1000);
    fire(document, 'pointermove', 490);
    expect(container.scrollTop).toBeGreaterThan(0);
  });
});
