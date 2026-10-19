import { WIDTH_PERCENT_RANGE } from '../constants';
import { IMAGE_ATTR } from '../dom-attributes';
import { readScale } from '../pagination';

export interface ImageHandlers {
  onResize(imageIndex: number, widthPercent: number): void;
  onResetSize(imageIndex: number): void;
}

const RESET_LABEL = '元のサイズに戻す';
const HANDLE_SIZE_PX = 12;
const RESET_GAP_PX = 6;

/** Width % of the content box for an image dragged by `deltaXPx` from `startWidthPx`, clamped and rounded. */
export function widthPercentFromDrag(startWidthPx: number, deltaXPx: number, contentWidthPx: number): number {
  if (!(contentWidthPx > 0)) return WIDTH_PERCENT_RANGE.max;
  const percent = Math.round(((startWidthPx + deltaXPx) / contentWidthPx) * 100);
  return Math.min(WIDTH_PERCENT_RANGE.max, Math.max(WIDTH_PERCENT_RANGE.min, percent));
}

const createButton = (className: string, text: string): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  return button;
};

/**
 * Lets a clicked image be resized from a bottom-right handle. Controls live in a
 * `.pl-ui` overlay layer so rendered content is untouched, apart from the transient
 * width shown while dragging. Returns detach.
 */
export function attachImageResizeHandles(previewHost: HTMLElement, handlers: ImageHandlers): () => void {
  const layer = document.createElement('div');
  layer.className = 'pl-ui pl-image-layer';
  let selected: HTMLElement | null = null;
  let stopDrag: (() => void) | null = null;

  const indexOf = (el: HTMLElement): number => Number(el.getAttribute(IMAGE_ATTR));

  interface Controls {
    outline: HTMLElement;
    handle: HTMLElement;
    reset: HTMLElement;
  }
  let controls: Controls | null = null;

  const place = (el: HTMLElement, hostRect: DOMRect, left: number, top: number, width?: number, height?: number): void => {
    el.style.position = 'absolute';
    el.style.left = `${left - hostRect.left}px`;
    el.style.top = `${top - hostRect.top}px`;
    if (width != null) el.style.width = `${width}px`;
    if (height != null) el.style.height = `${height}px`;
  };

  /** Moves the existing controls to the selected image; never replaces nodes (the handle may hold pointer capture). */
  function position(): void {
    if (selected == null || controls == null) return;
    const hostRect = previewHost.getBoundingClientRect();
    const rect = selected.getBoundingClientRect();
    place(controls.outline, hostRect, rect.left, rect.top, rect.width, rect.height);
    place(controls.handle, hostRect, rect.right - HANDLE_SIZE_PX / 2, rect.bottom - HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
    place(controls.reset, hostRect, rect.left, rect.bottom + RESET_GAP_PX);
  }

  function render(): void {
    controls = null;
    if (selected == null) {
      layer.replaceChildren();
      return;
    }
    const target = selected;
    const outline = document.createElement('div');
    outline.className = 'pl-ui pl-image-outline';
    const handle = document.createElement('div');
    handle.className = 'pl-ui pl-image-handle';
    const reset = createButton('pl-image-reset', RESET_LABEL);
    reset.addEventListener('click', () => handlers.onResetSize(indexOf(target)));
    handle.addEventListener('pointerdown', (e) => {
      if (e.button === 0) startDrag(target, handle, e);
    });
    layer.replaceChildren(outline, handle, reset);
    controls = { outline, handle, reset };
    position();
  }

  function select(el: HTMLElement | null): void {
    stopDrag?.();
    selected = el;
    render();
  }

  function startDrag(image: HTMLElement, handle: HTMLElement, down: PointerEvent): void {
    stopDrag?.();
    down.preventDefault();
    const scale = readScale(image);
    const startWidth = image.getBoundingClientRect().width / scale;
    const content = image.closest<HTMLElement>('.pl-content') ?? previewHost;
    const svg = image.querySelector('svg');
    const original = { width: image.style.width, height: image.style.height, svgWidth: svg?.style.width ?? null };
    try {
      handle.setPointerCapture?.(down.pointerId);
    } catch {
      // Capture is only an aid; document listeners below carry the drag.
    }
    // Content width is re-read on every call: it may have reflowed during the drag.
    const measure = (e: PointerEvent): { percent: number; contentWidth: number } => {
      const contentWidth = content.getBoundingClientRect().width;
      return { percent: widthPercentFromDrag(startWidth, (e.clientX - down.clientX) / scale, contentWidth), contentWidth };
    };
    const onMove = (e: PointerEvent): void => {
      const { percent, contentWidth } = measure(e);
      image.style.width = `${(contentWidth * percent) / 100}px`;
      image.style.height = 'auto';
      if (svg != null) svg.style.width = '100%';
      position();
    };
    const restore = (): void => {
      image.style.width = original.width;
      image.style.height = original.height;
      if (svg != null && original.svgWidth != null) svg.style.width = original.svgWidth;
    };
    const startPercent = widthPercentFromDrag(startWidth, 0, content.getBoundingClientRect().width);
    const onUp = (e: PointerEvent): void => {
      const { percent } = measure(e);
      // stopDrag restores the captured styles, so a no-op resize leaves no transient width behind.
      stopDrag?.();
      // A click on the handle, or a drag back to where it began, must not pin the current width.
      const moved = e.clientX !== down.clientX || e.clientY !== down.clientY;
      if (moved && percent !== startPercent) handlers.onResize(indexOf(image), percent);
    };
    const onCancel = (): void => {
      stopDrag?.();
      position();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    // Every way a drag ends other than a committed pointerup funnels through here and restores the image.
    stopDrag = () => {
      restore();
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      stopDrag = null;
    };
  }

  const onClick = (e: MouseEvent): void => {
    if (!(e.target instanceof Element) || layer.contains(e.target)) return;
    const image = e.target.closest<HTMLElement>(`[${IMAGE_ATTR}]`);
    select(image != null && previewHost.contains(image) ? image : null);
  };
  const onDocumentPointerDown = (e: PointerEvent): void => {
    if (selected == null || !(e.target instanceof Node)) return;
    if (previewHost.contains(e.target) && (layer.contains(e.target) || (e.target instanceof Element && e.target.closest(`[${IMAGE_ATTR}]`) != null))) return;
    select(null);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && selected != null) select(null);
  };

  previewHost.appendChild(layer);
  previewHost.addEventListener('click', onClick);
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onKeyDown);
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (stopDrag == null) position();
        });
  observer?.observe(previewHost);
  return () => {
    stopDrag?.();
    observer?.disconnect();
    previewHost.removeEventListener('click', onClick);
    document.removeEventListener('pointerdown', onDocumentPointerDown);
    document.removeEventListener('keydown', onKeyDown);
    layer.remove();
  };
}
