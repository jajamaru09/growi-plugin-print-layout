import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { attachColumnRatioHandles, leftPercentFromDrag } from './column-ratio-handles';

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
});

interface Fixture {
  host: HTMLElement;
  content: HTMLElement;
  container: HTMLElement;
  first: HTMLElement;
  second: HTMLElement;
}

/** A 600px wide two-column container (index 1) whose columns are 300px each; `reversed` shows the DOM-first child on the right. */
function buildHost(reversed = false): Fixture {
  const host = document.createElement('div');
  host.getBoundingClientRect = () => rect(0, 0, 800, 1000);
  const content = document.createElement('div');
  content.className = 'pl-content';
  content.getBoundingClientRect = () => rect(0, 0, 600, 1000);
  const container = document.createElement('div');
  container.setAttribute('data-pl-columns', '1');
  container.getBoundingClientRect = () => rect(0, 0, 600, 200);
  const first = document.createElement('div');
  first.className = 'f2_item';
  first.getBoundingClientRect = () => rect(reversed ? 300 : 0, 0, 300, 200);
  const second = document.createElement('div');
  second.style.flex = '1 1 0%';
  second.getBoundingClientRect = () => rect(reversed ? 0 : 300, 0, 300, 200);
  const image = document.createElement('img');
  image.setAttribute('data-pl-image', '0');
  first.appendChild(image);
  container.append(first, second);
  content.appendChild(container);
  host.appendChild(content);
  document.body.appendChild(host);
  return { host, content, container, first, second };
}

const handlers = () => ({ onSetRatio: vi.fn(), onResetRatio: vi.fn() });
const fire = (target: EventTarget, type: string, clientX = 0): void => {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, button: 0 }));
};
const dividerOf = (host: HTMLElement): HTMLElement => {
  const divider = host.querySelector<HTMLElement>('.pl-column-divider');
  if (divider == null) throw new Error('no divider');
  return divider;
};
const flexes = (f: Fixture): string[] => [f.first.style.flex, f.second.style.flex];

describe('leftPercentFromDrag', () => {
  test('leftPercentFromDrag(300, 150, 1000) === 45', () => {
    expect(leftPercentFromDrag(300, 150, 1000)).toBe(45);
  });
  test('rounds to a multiple of 5', () => {
    expect(leftPercentFromDrag(300, 20, 1000)).toBe(30);
    expect(leftPercentFromDrag(300, 30, 1000)).toBe(35);
  });
  test('clamps to 10 and 90', () => {
    expect(leftPercentFromDrag(300, -900, 1000)).toBe(10);
    expect(leftPercentFromDrag(300, 900, 1000)).toBe(90);
  });
});

describe('attachColumnRatioHandles', () => {
  beforeEach(() => document.body.replaceChildren());
  afterEach(() => document.body.replaceChildren());

  test('clicking a column shows a divider; clicking outside or pressing Escape hides it', () => {
    const f = buildHost();
    attachColumnRatioHandles(f.host, handlers());
    expect(f.host.querySelector('.pl-column-divider')).toBeNull();
    fire(f.second, 'click');
    expect(f.host.querySelector('.pl-column-divider')).not.toBeNull();
    fire(f.content, 'pointerdown');
    expect(f.host.querySelector('.pl-column-divider')).toBeNull();
    fire(f.second, 'click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(f.host.querySelector('.pl-column-divider')).toBeNull();
  });

  test('clicking an image inside a column leaves the column unselected', () => {
    const f = buildHost();
    attachColumnRatioHandles(f.host, handlers());
    fire(f.first.querySelector('img') as HTMLElement, 'click');
    expect(f.host.querySelector('.pl-column-divider')).toBeNull();
  });

  test('the divider sits on the boundary between the columns', () => {
    const f = buildHost();
    attachColumnRatioHandles(f.host, handlers());
    fire(f.second, 'click');
    const divider = dividerOf(f.host);
    const left = Number.parseFloat(divider.style.left);
    const width = Number.parseFloat(divider.style.width);
    expect(left + width / 2).toBe(300);
  });

  test('dragging shows the ratio and pointerup calls onSetRatio once with the left percent', () => {
    const f = buildHost();
    const h = handlers();
    attachColumnRatioHandles(f.host, h);
    fire(f.second, 'click');
    fire(dividerOf(f.host), 'pointerdown', 300);
    fire(document, 'pointermove', 180);
    expect(flexes(f)).toEqual(['30 1 0px', '70 1 0px']);
    fire(document, 'pointerup', 180);
    expect(h.onSetRatio).toHaveBeenCalledTimes(1);
    expect(h.onSetRatio).toHaveBeenCalledWith(1, 30);
    fire(document, 'pointerup', 180);
    expect(h.onSetRatio).toHaveBeenCalledTimes(1);
  });

  test('a click on the divider without moving does not call onSetRatio', () => {
    const f = buildHost();
    const h = handlers();
    attachColumnRatioHandles(f.host, h);
    fire(f.second, 'click');
    fire(dividerOf(f.host), 'pointerdown', 300);
    fire(document, 'pointerup', 300);
    expect(h.onSetRatio).not.toHaveBeenCalled();
    expect(flexes(f)).toEqual(['', '1 1 0%']);
  });

  test('a drag that ends on the starting ratio does not call onSetRatio', () => {
    const f = buildHost();
    const h = handlers();
    attachColumnRatioHandles(f.host, h);
    fire(f.second, 'click');
    fire(dividerOf(f.host), 'pointerdown', 300);
    fire(document, 'pointermove', 310);
    fire(document, 'pointerup', 310);
    expect(h.onSetRatio).not.toHaveBeenCalled();
    expect(flexes(f)).toEqual(['', '1 1 0%']);
  });

  test('pointerup restores the captured styles before calling onSetRatio', () => {
    const f = buildHost();
    let atCall: string[] = [];
    const h = { onSetRatio: vi.fn(() => { atCall = flexes(f); }), onResetRatio: vi.fn() };
    attachColumnRatioHandles(f.host, h);
    fire(f.second, 'click');
    fire(dividerOf(f.host), 'pointerdown', 300);
    fire(document, 'pointermove', 180);
    fire(document, 'pointerup', 180);
    expect(atCall).toEqual(['', '1 1 0%']);
  });

  test('with row-reverse the ratio is stored for the DOM-first child, which shows on the right', () => {
    const f = buildHost(true);
    const h = handlers();
    attachColumnRatioHandles(f.host, h);
    fire(f.second, 'click');
    fire(dividerOf(f.host), 'pointerdown', 300);
    fire(document, 'pointermove', 180);
    expect(flexes(f)).toEqual(['70 1 0px', '30 1 0px']);
    fire(document, 'pointerup', 180);
    expect(h.onSetRatio).toHaveBeenCalledWith(1, 70);
  });

  test('Escape mid-drag restores the columns and does not call onSetRatio', () => {
    const f = buildHost();
    const h = handlers();
    attachColumnRatioHandles(f.host, h);
    fire(f.second, 'click');
    fire(dividerOf(f.host), 'pointerdown', 300);
    fire(document, 'pointermove', 180);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(flexes(f)).toEqual(['', '1 1 0%']);
    fire(document, 'pointerup', 180);
    expect(h.onSetRatio).not.toHaveBeenCalled();
  });

  test('pointercancel restores the columns and does not call onSetRatio', () => {
    const f = buildHost();
    const h = handlers();
    attachColumnRatioHandles(f.host, h);
    fire(f.second, 'click');
    fire(dividerOf(f.host), 'pointerdown', 300);
    fire(document, 'pointermove', 420);
    fire(document, 'pointercancel');
    expect(flexes(f)).toEqual(['', '1 1 0%']);
    expect(h.onSetRatio).not.toHaveBeenCalled();
  });

  test('detach mid-drag restores the columns and removes the layer and listeners', () => {
    const f = buildHost();
    const h = handlers();
    const detach = attachColumnRatioHandles(f.host, h);
    fire(f.second, 'click');
    fire(dividerOf(f.host), 'pointerdown', 300);
    fire(document, 'pointermove', 420);
    detach();
    expect(flexes(f)).toEqual(['', '1 1 0%']);
    expect(f.host.querySelector('.pl-column-layer')).toBeNull();
    fire(document, 'pointerup', 420);
    expect(h.onSetRatio).not.toHaveBeenCalled();
    fire(f.second, 'click');
    expect(f.host.querySelector('.pl-column-divider')).toBeNull();
  });

  test('the divider element survives pointermoves', () => {
    const f = buildHost();
    attachColumnRatioHandles(f.host, handlers());
    fire(f.second, 'click');
    const divider = dividerOf(f.host);
    fire(divider, 'pointerdown', 300);
    fire(document, 'pointermove', 250);
    fire(document, 'pointermove', 200);
    expect(dividerOf(f.host)).toBe(divider);
  });

  test('"元の比率に戻す" calls onResetRatio', () => {
    const f = buildHost();
    const h = handlers();
    attachColumnRatioHandles(f.host, h);
    fire(f.second, 'click');
    const reset = Array.from(f.host.querySelectorAll('button')).find((b) => b.textContent === '元の比率に戻す');
    reset?.click();
    expect(h.onResetRatio).toHaveBeenCalledWith(1);
  });
});
