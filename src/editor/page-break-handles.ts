import { BLOCK_ATTR, BREAK_ATTR } from '../dom-attributes';

export interface BreakHandlers {
  onAdd(blockIndex: number): void;
  onMove(fromBlockIndex: number, toBlockIndex: number): void;
  onRemove(blockIndex: number): void;
}

const ADD_LABEL = '＋ ここで改ページ';
const REMOVE_LABEL = '改ページを削除';
const ZONE_HEIGHT_PX = 16;
export const ADD_ZONE_WIDTH_PX = 140;
const LINE_HEIGHT_PX = 12;
const EDGE_SCROLL_ZONE_PX = 40;
const EDGE_SCROLL_STEP_PX = 20;

interface Boundary {
  blockIndex: number;
  /** Viewport y of the top edge of the block's first fragment. */
  y: number;
  pageStart: boolean;
  isFirstPage: boolean;
  /** Page frame geometry in viewport coordinates. */
  pageLeft: number;
  pageWidth: number;
}

/** Boundaries sit between consecutive distinct block indexes; fragments of one split block form none. */
function collectBoundaries(host: HTMLElement): { boundaries: Boundary[]; autoStarts: Boundary[] } {
  const boundaries: Boundary[] = [];
  const autoStarts: Boundary[] = [];
  let previousIndex: number | null = null;
  let previousPage: Element | null = null;
  let firstPage: Element | null = null;
  for (const el of Array.from(host.querySelectorAll<HTMLElement>(`[${BLOCK_ATTR}]`))) {
    const blockIndex = Number(el.getAttribute(BLOCK_ATTR));
    const page = el.closest('.pl-page') ?? host;
    firstPage ??= page;
    const pageStart = page !== previousPage;
    const pageRect = page.getBoundingClientRect();
    const entry: Boundary = {
      blockIndex,
      y: el.getBoundingClientRect().top,
      pageStart,
      isFirstPage: page === firstPage,
      pageLeft: pageRect.left,
      pageWidth: pageRect.width,
    };
    if (previousIndex !== null && blockIndex !== previousIndex) boundaries.push(entry);
    else if (previousIndex !== null && pageStart) autoStarts.push(entry);
    previousIndex = blockIndex;
    previousPage = page;
  }
  return { boundaries, autoStarts };
}

const nearestBoundary = (boundaries: readonly Boundary[], clientY: number): Boundary | null =>
  boundaries.reduce<Boundary | null>(
    (best, b) => (best == null || Math.abs(b.y - clientY) < Math.abs(best.y - clientY) ? b : best),
    null,
  );

/** With `widthPx` the element is centred on the page frame; without it, it spans the frame. */
const place = (el: HTMLElement, b: Boundary, hostRect: DOMRect, heightPx: number, widthPx?: number): void => {
  const width = widthPx ?? b.pageWidth;
  const left = b.pageLeft + (b.pageWidth - width) / 2;
  el.style.position = 'absolute';
  el.style.left = `${left - hostRect.left}px`;
  el.style.width = `${width}px`;
  el.style.top = `${b.y - hostRect.top - heightPx / 2}px`;
  el.style.height = `${heightPx}px`;
};

const createButton = (className: string, text: string, label?: string): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  if (label != null) button.setAttribute('aria-label', label);
  return button;
};

/** Nudges the container when the pointer is near its top or bottom edge, so a drag can cross pages. */
const edgeScroll = (container: HTMLElement, clientY: number): void => {
  const rect = container.getBoundingClientRect();
  if (clientY < rect.top + EDGE_SCROLL_ZONE_PX) container.scrollTop -= EDGE_SCROLL_STEP_PX;
  else if (clientY > rect.bottom - EDGE_SCROLL_ZONE_PX) container.scrollTop += EDGE_SCROLL_STEP_PX;
};

/**
 * Overlays break controls on the rendered pages. Everything lives in one absolutely
 * positioned `.pl-ui` layer, so the measured page content is untouched. Returns detach.
 */
export function attachPageBreakHandles(
  previewHost: HTMLElement,
  manualBreaks: ReadonlySet<number>,
  handlers: BreakHandlers,
): () => void {
  const layer = document.createElement('div');
  layer.className = 'pl-ui pl-break-layer';
  let stopDrag: (() => void) | null = null;

  function build(): void {
    const hostRect = previewHost.getBoundingClientRect();
    const { boundaries, autoStarts } = collectBoundaries(previewHost);
    const children: HTMLElement[] = [];
    for (const b of autoStarts.concat(boundaries)) {
      if (b.isFirstPage || !b.pageStart || manualBreaks.has(b.blockIndex)) continue;
      const line = document.createElement('div');
      line.className = 'pl-ui pl-auto-break';
      place(line, b, hostRect, 1);
      children.push(line);
    }
    for (const b of boundaries) {
      children.push(manualBreaks.has(b.blockIndex) ? createManualBreak(b, hostRect) : createAddZone(b, hostRect));
    }
    layer.replaceChildren(...children);
  }

  function createAddZone(b: Boundary, hostRect: DOMRect): HTMLElement {
    const zone = document.createElement('div');
    zone.className = 'pl-ui pl-break-add';
    place(zone, b, hostRect, ZONE_HEIGHT_PX, ADD_ZONE_WIDTH_PX);
    const button = createButton('pl-break-add-button', ADD_LABEL);
    button.addEventListener('click', () => handlers.onAdd(b.blockIndex));
    zone.appendChild(button);
    return zone;
  }

  function createManualBreak(b: Boundary, hostRect: DOMRect): HTMLElement {
    const line = document.createElement('div');
    line.className = 'pl-ui pl-manual-break';
    line.setAttribute(BREAK_ATTR, String(b.blockIndex));
    place(line, b, hostRect, LINE_HEIGHT_PX);
    const remove = createButton('pl-break-remove', '×', REMOVE_LABEL);
    remove.addEventListener('click', () => handlers.onRemove(b.blockIndex));
    line.appendChild(remove);
    line.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button') != null)) return;
      startDrag(line, b.blockIndex, e);
    });
    return line;
  }

  function startDrag(line: HTMLElement, from: number, down: PointerEvent): void {
    stopDrag?.();
    const container = previewHost.closest<HTMLElement>('.pl-preview') ?? previewHost;
    const originalTop = line.style.top;
    try {
      line.setPointerCapture?.(down.pointerId);
    } catch {
      // Capture is only an aid; document listeners below carry the drag.
    }
    const onMove = (e: PointerEvent): void => {
      edgeScroll(container, e.clientY);
      line.style.top = `${e.clientY - previewHost.getBoundingClientRect().top - LINE_HEIGHT_PX / 2}px`;
    };
    const finish = (e: PointerEvent | null): void => {
      stopDrag?.();
      // Geometry is read fresh: the preview may have scrolled or reflowed during the drag.
      const targets = collectBoundaries(previewHost).boundaries;
      const target = e == null ? null : nearestBoundary(targets, e.clientY);
      // Dropping nearest another manual break is a no-op rather than a merge.
      if (target != null && target.blockIndex !== from && !manualBreaks.has(target.blockIndex)) {
        handlers.onMove(from, target.blockIndex);
      } else {
        line.style.top = originalTop;
      }
    };
    const onUp = (e: PointerEvent): void => finish(e);
    const onCancel = (): void => finish(null);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    stopDrag = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      stopDrag = null;
    };
  }

  build();
  previewHost.appendChild(layer);
  // A rebuild mid-drag would drop the dragged line, so it is skipped then.
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (stopDrag == null) build();
        });
  observer?.observe(previewHost);
  return () => {
    stopDrag?.();
    observer?.disconnect();
    layer.remove();
  };
}
