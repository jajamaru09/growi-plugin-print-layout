import { COLUMN_PERCENT_RANGE, COLUMN_PERCENT_STEP } from '../constants';
import { COLUMNS_ATTR, IMAGE_ATTR } from '../dom-attributes';
import { columnFlex } from './column-ratios';

export interface ColumnHandlers {
  onSetRatio(columnIndex: number, leftPercent: number): void;
  onResetRatio(columnIndex: number): void;
}

const RESET_LABEL = '元の比率に戻す';
const DIVIDER_WIDTH_PX = 10;
const RESET_GAP_PX = 6;

/** Left-column share (%) after dragging the divider by `deltaXPx`, in steps of 5 within 10..90. */
export function leftPercentFromDrag(startLeftPx: number, deltaXPx: number, containerWidthPx: number): number {
  const { min, max } = COLUMN_PERCENT_RANGE;
  if (!(containerWidthPx > 0)) return min;
  const percent = ((startLeftPx + deltaXPx) / containerWidthPx) * 100;
  const stepped = Math.round(percent / COLUMN_PERCENT_STEP) * COLUMN_PERCENT_STEP;
  return Math.min(max, Math.max(min, stepped));
}

interface ColumnGeometry {
  /** The DOM-first and DOM-second columns. */
  children: [HTMLElement, HTMLElement];
  /** True when the DOM-first column is the one shown on the left (false under row-reverse). */
  firstOnLeft: boolean;
  leftRect: DOMRect;
  rightRect: DOMRect;
}

/** Read fresh on every use: the preview may scroll or reflow at any time. */
const geometryOf = (container: HTMLElement): ColumnGeometry | null => {
  const [first, second] = Array.from(container.children);
  if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) return null;
  const firstRect = first.getBoundingClientRect();
  const secondRect = second.getBoundingClientRect();
  const firstOnLeft = firstRect.left <= secondRect.left;
  return {
    children: [first, second],
    firstOnLeft,
    leftRect: firstOnLeft ? firstRect : secondRect,
    rightRect: firstOnLeft ? secondRect : firstRect,
  };
};

const createButton = (className: string, text: string): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  return button;
};

/**
 * Lets a clicked two-column layout be re-proportioned by dragging the divider between its
 * columns. Controls live in a `.pl-ui` overlay layer so rendered content is untouched, apart
 * from the transient ratio shown while dragging. Returns detach.
 */
export function attachColumnRatioHandles(previewHost: HTMLElement, handlers: ColumnHandlers): () => void {
  const layer = document.createElement('div');
  layer.className = 'pl-ui pl-column-layer';
  let selected: HTMLElement | null = null;
  let stopDrag: (() => void) | null = null;

  const indexOf = (el: HTMLElement): number => Number(el.getAttribute(COLUMNS_ATTR));

  interface Controls {
    outline: HTMLElement;
    divider: HTMLElement;
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

  /** Moves the existing controls to the selected layout; never replaces nodes (the divider may hold pointer capture). */
  function position(): void {
    if (selected == null || controls == null) return;
    const geometry = geometryOf(selected);
    if (geometry == null) return;
    const hostRect = previewHost.getBoundingClientRect();
    const rect = selected.getBoundingClientRect();
    const boundary = (geometry.leftRect.right + geometry.rightRect.left) / 2;
    place(controls.outline, hostRect, rect.left, rect.top, rect.width, rect.height);
    place(controls.divider, hostRect, boundary - DIVIDER_WIDTH_PX / 2, rect.top, DIVIDER_WIDTH_PX, rect.height);
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
    outline.className = 'pl-ui pl-column-outline';
    const divider = document.createElement('div');
    divider.className = 'pl-ui pl-column-divider';
    const reset = createButton('pl-column-reset', RESET_LABEL);
    reset.addEventListener('click', () => handlers.onResetRatio(indexOf(target)));
    divider.addEventListener('pointerdown', (e) => {
      if (e.button === 0) startDrag(target, divider, e);
    });
    layer.replaceChildren(outline, divider, reset);
    controls = { outline, divider, reset };
    position();
  }

  function select(el: HTMLElement | null): void {
    stopDrag?.();
    selected = el;
    render();
  }

  function startDrag(container: HTMLElement, divider: HTMLElement, down: PointerEvent): void {
    stopDrag?.();
    const start = geometryOf(container);
    if (start == null) return;
    down.preventDefault();
    const [first, second] = start.children;
    const original = [first.style.flex, second.style.flex];
    const startLeft = start.leftRect.width;
    try {
      divider.setPointerCapture?.(down.pointerId);
    } catch {
      // Capture is only an aid; document listeners below carry the drag.
    }
    // The ratio is stored for the DOM-first column, which shows on the right under row-reverse.
    const firstPercent = (e: PointerEvent): number => {
      const now = geometryOf(container) ?? start;
      const total = now.leftRect.width + now.rightRect.width;
      const left = leftPercentFromDrag(startLeft, e.clientX - down.clientX, total);
      return start.firstOnLeft ? left : 100 - left;
    };
    const onMove = (e: PointerEvent): void => {
      const percent = firstPercent(e);
      first.style.flex = columnFlex(percent);
      second.style.flex = columnFlex(100 - percent);
      position();
    };
    const restore = (): void => {
      first.style.flex = original[0];
      second.style.flex = original[1];
    };
    const startPercent = firstPercent(down);
    const onUp = (e: PointerEvent): void => {
      const percent = firstPercent(e);
      // stopDrag restores the captured styles, so a no-op drag leaves no transient ratio behind.
      stopDrag?.();
      // A click on the divider, or a drag back to where it began, must not pin the current ratio.
      const moved = e.clientX !== down.clientX || e.clientY !== down.clientY;
      if (moved && percent !== startPercent) handlers.onSetRatio(indexOf(container), percent);
    };
    const onCancel = (): void => {
      stopDrag?.();
      position();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    // Every way a drag ends other than a committed pointerup funnels through here and restores the columns.
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
    // A click on an image belongs to the image resize handles.
    if (e.target.closest(`[${IMAGE_ATTR}]`) != null) return;
    const container = e.target.closest<HTMLElement>(`[${COLUMNS_ATTR}]`);
    select(container != null && previewHost.contains(container) ? container : null);
  };
  const onDocumentPointerDown = (e: PointerEvent): void => {
    if (selected == null || !(e.target instanceof Node)) return;
    if (previewHost.contains(e.target) && (layer.contains(e.target) || (e.target instanceof Element && e.target.closest(`[${COLUMNS_ATTR}]`) != null))) return;
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
