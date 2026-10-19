import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { attachImageResizeHandles, widthPercentFromDrag } from './image-resize-handles';

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
});

interface Fixture {
  host: HTMLElement;
  content: HTMLElement;
  image: HTMLElement;
}

/** A page whose content box is 600px wide holding one image of `imageWidth` px (shown at `scale`). */
function buildHost(imageWidth = 300, scale = 1): Fixture {
  const host = document.createElement('div');
  host.getBoundingClientRect = () => rect(0, 0, 800, 1000);
  const content = document.createElement('div');
  content.className = 'pl-content';
  content.getBoundingClientRect = () => rect(0, 0, 600, 1000);
  const image = document.createElement('img');
  image.setAttribute('data-pl-image', '2');
  image.getBoundingClientRect = () => rect(0, 0, imageWidth * scale, 100 * scale);
  if (scale === 1) {
    content.appendChild(image);
  } else {
    const outer = document.createElement('div');
    outer.className = 'pl-scaled';
    const inner = document.createElement('div');
    inner.style.transform = `scale(${scale})`;
    inner.setAttribute('data-pl-scale', String(scale));
    inner.appendChild(image);
    outer.appendChild(inner);
    content.appendChild(outer);
  }
  host.appendChild(content);
  document.body.appendChild(host);
  return { host, content, image };
}

const handlers = () => ({ onResize: vi.fn(), onResetSize: vi.fn() });
const fire = (target: EventTarget, type: string, clientX = 0): void => {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, button: 0 }));
};
const select = (image: HTMLElement): void => fire(image, 'click');
const handleOf = (host: HTMLElement): HTMLElement => {
  const handle = host.querySelector<HTMLElement>('.pl-image-handle');
  if (handle == null) throw new Error('no handle');
  return handle;
};

describe('widthPercentFromDrag', () => {
  test('widthPercentFromDrag(300, 150, 600) === 75', () => {
    expect(widthPercentFromDrag(300, 150, 600)).toBe(75);
  });
  test('widthPercentFromDrag clamps to 5 and 100', () => {
    expect(widthPercentFromDrag(300, 900, 600)).toBe(100);
    expect(widthPercentFromDrag(300, -900, 600)).toBe(5);
  });
  test('rounds to an integer', () => {
    expect(widthPercentFromDrag(100, 0, 300)).toBe(33);
  });
});

describe('attachImageResizeHandles', () => {
  beforeEach(() => document.body.replaceChildren());
  afterEach(() => document.body.replaceChildren());

  test('clicking an image shows a handle; clicking elsewhere or pressing Escape hides it', () => {
    const { host, image, content } = buildHost();
    attachImageResizeHandles(host, handlers());
    expect(host.querySelector('.pl-image-handle')).toBeNull();
    select(image);
    expect(host.querySelector('.pl-image-handle')).not.toBeNull();
    fire(content, 'pointerdown');
    expect(host.querySelector('.pl-image-handle')).toBeNull();
    select(image);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.querySelector('.pl-image-handle')).toBeNull();
  });

  test('pointerup after dragging the handle calls onResize once with the computed percent', () => {
    const { host, image } = buildHost(300);
    const h = handlers();
    attachImageResizeHandles(host, h);
    select(image);
    fire(handleOf(host), 'pointerdown', 300);
    fire(document, 'pointermove', 450);
    expect(image.style.width).toBe('450px');
    fire(document, 'pointerup', 450);
    expect(h.onResize).toHaveBeenCalledTimes(1);
    expect(h.onResize).toHaveBeenCalledWith(2, 75);
    fire(document, 'pointerup', 450);
    expect(h.onResize).toHaveBeenCalledTimes(1);
  });

  test('a click on the handle without moving does not call onResize', () => {
    const { host, image } = buildHost(300);
    const h = handlers();
    attachImageResizeHandles(host, h);
    select(image);
    fire(handleOf(host), 'pointerdown', 300);
    fire(document, 'pointerup', 300);
    expect(h.onResize).not.toHaveBeenCalled();
    expect(image.style.width).toBe('');
  });

  test('a drag that ends on the starting width does not call onResize', () => {
    const { host, image } = buildHost(300);
    const h = handlers();
    attachImageResizeHandles(host, h);
    select(image);
    fire(handleOf(host), 'pointerdown', 300);
    fire(document, 'pointermove', 302);
    fire(document, 'pointerup', 302);
    expect(h.onResize).not.toHaveBeenCalled();
    expect(image.style.width).toBe('');
  });

  test('a drag inside a scaled block uses unscaled widths', () => {
    const { host, image } = buildHost(300, 0.5);
    const h = handlers();
    attachImageResizeHandles(host, h);
    select(image);
    fire(handleOf(host), 'pointerdown', 150);
    fire(document, 'pointerup', 225);
    expect(h.onResize).toHaveBeenCalledWith(2, 75);
  });

  test('a cancelled drag restores the width and does not call onResize', () => {
    const { host, image } = buildHost(300);
    image.style.width = '50%';
    const h = handlers();
    attachImageResizeHandles(host, h);
    select(image);
    fire(handleOf(host), 'pointerdown', 300);
    fire(document, 'pointermove', 500);
    fire(document, 'pointercancel');
    expect(image.style.width).toBe('50%');
    expect(h.onResize).not.toHaveBeenCalled();
  });

  test('Escape mid-drag restores the width and does not call onResize', () => {
    const { host, image } = buildHost(300);
    image.style.width = '50%';
    const h = handlers();
    attachImageResizeHandles(host, h);
    select(image);
    fire(handleOf(host), 'pointerdown', 300);
    fire(document, 'pointermove', 450);
    expect(image.style.width).toBe('450px');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(image.style.width).toBe('50%');
    fire(document, 'pointerup', 450);
    expect(h.onResize).not.toHaveBeenCalled();
  });

  test('detach mid-drag restores the width and does not call onResize', () => {
    const { host, image } = buildHost(300);
    const h = handlers();
    const detach = attachImageResizeHandles(host, h);
    select(image);
    fire(handleOf(host), 'pointerdown', 300);
    fire(document, 'pointermove', 500);
    detach();
    expect(image.style.width).toBe('');
    expect(h.onResize).not.toHaveBeenCalled();
  });

  test('the handle element survives pointermoves', () => {
    const { host, image } = buildHost(300);
    attachImageResizeHandles(host, handlers());
    select(image);
    const handle = handleOf(host);
    fire(handle, 'pointerdown', 300);
    fire(document, 'pointermove', 350);
    fire(document, 'pointermove', 400);
    expect(handleOf(host)).toBe(handle);
  });

  test('pointerup restores the captured width before calling onResize', () => {
    const { host, image } = buildHost(300);
    let widthAtCall = 'unset';
    const h = { onResize: vi.fn(() => { widthAtCall = image.style.width; }), onResetSize: vi.fn() };
    attachImageResizeHandles(host, h);
    select(image);
    fire(handleOf(host), 'pointerdown', 300);
    fire(document, 'pointermove', 450);
    fire(document, 'pointerup', 450);
    expect(widthAtCall).toBe('');
  });

  test('a drawio svg follows the drag and is restored on abort', () => {
    const { host, image } = buildHost(300);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.width = '300px';
    image.appendChild(svg);
    attachImageResizeHandles(host, handlers());
    select(image);
    fire(handleOf(host), 'pointerdown', 300);
    fire(document, 'pointermove', 450);
    expect(svg.style.width).toBe('100%');
    fire(document, 'pointercancel');
    expect(svg.style.width).toBe('300px');
  });

  test('pointermove in a scaled block shows the unscaled width', () => {
    const { host, image } = buildHost(300, 0.5);
    attachImageResizeHandles(host, handlers());
    select(image);
    fire(handleOf(host), 'pointerdown', 150);
    fire(document, 'pointermove', 225);
    expect(image.style.width).toBe('450px');
  });

  test('"元のサイズに戻す" calls onResetSize', () => {
    const { host, image } = buildHost();
    const h = handlers();
    attachImageResizeHandles(host, h);
    select(image);
    const reset = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '元のサイズに戻す');
    reset?.click();
    expect(h.onResetSize).toHaveBeenCalledWith(2);
  });

  test('detach removes the layer and the listeners', () => {
    const { host, image } = buildHost();
    const detach = attachImageResizeHandles(host, handlers());
    detach();
    expect(host.querySelector('.pl-image-layer')).toBeNull();
    select(image);
    expect(host.querySelector('.pl-image-handle')).toBeNull();
  });
});
