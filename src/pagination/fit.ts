import type { CapturedContent, FitTarget } from '../capture';
import type { FitOverride } from '../layout';
import { forEachCounterpart } from './counterparts';
import { borderInsets, contentInsets } from './box';
import { decideFit, type FitInput, type FitWarning, fitWarning, nextScale, wrapsFor } from './fit-math';
import { withLaidOutClones } from './offscreen';

/** On every fit target: nothing inside a page may scroll. */
export const FIT_CLASS = 'pl-fit';
/** On fit targets that are not shrink-only: cells and code lines wrap. */
export const FIT_WRAP_CLASS = 'pl-fit-wrap';

export interface FitResult {
  index: number;
  kind: FitTarget['kind'];
  mode: 'auto' | FitOverride['mode'];
  scale: number;
  warning: FitWarning | null;
}

// Runs overlap (an edit during a run starts another); only the newest may write zoom onto the content.
const latestRun = new WeakMap<CapturedContent, number>();

const contentBoxWidth = (el: Element): number => {
  const insets = contentInsets(el);
  return el.getBoundingClientRect().width - insets.left - insets.right;
};

/**
 * Room for a target in `parent`. A parent with no box (`display: contents`) or one that collapses
 * without the target (inline-block, float) has none, so the nearest ancestor with a width bounds it.
 */
const availableWidth = (parent: Element | null): number => {
  for (let el = parent; el != null; el = el.parentElement) {
    const width = contentBoxWidth(el);
    if (width > 0) return width;
  }
  return Number.NaN;
};

/** Takes `el` out of flow; the returned function puts back its previous inline display. */
const hide = (el: HTMLElement): (() => void) => {
  const display = el.style.getPropertyValue('display');
  const priority = el.style.getPropertyPriority('display');
  el.style.setProperty('display', 'none', 'important');
  return () => {
    if (display === '') el.style.removeProperty('display');
    else el.style.setProperty('display', display, priority);
  };
};

/** Border-box width of the target; the fit rules keep its whole subtree from scrolling, so scrollWidth sees it all. */
const naturalWidth = (target: HTMLElement): number => {
  const border = borderInsets(target);
  return target.scrollWidth + border.left + border.right;
};

const zoomFor = (scale: number): string => (scale < 1 ? String(scale) : '');

// Each step only goes lower, so a few are enough; a target still too wide after them is clipped and flagged.
const MAX_SETTLE_STEPS = 5;

/**
 * Zooms the clone to `scale` and, unless the scale is fixed, steps it down until it lays out within
 * `availablePx`. Returns the final scale and the clone's natural width laid out at it.
 */
const settle = (clone: HTMLElement, scale: number, availablePx: number, fixed: boolean): { scale: number; naturalPx: number } => {
  let current = scale;
  for (let step = 0; ; step++) {
    clone.style.zoom = zoomFor(current);
    const naturalPx = naturalWidth(clone);
    const next = fixed || current >= 1 || step === MAX_SETTLE_STEPS ? null : nextScale(current, availablePx, naturalPx * current);
    if (next == null) return { scale: current, naturalPx };
    current = next;
  }
};

const resetTargets = (fits: readonly FitTarget[], overrides: Readonly<Record<number, FitOverride>>): void => {
  fits.forEach(({ element }, i) => {
    element.style.zoom = '';
    element.classList.add(FIT_CLASS);
    element.classList.toggle(FIT_WRAP_CLASS, wrapsFor(overrides[i]));
  });
};

const cloneTargets = (content: CapturedContent, clones: readonly HTMLElement[]): Map<Element, HTMLElement> => {
  const targets = new Set<Element>(content.fits.map((f) => f.element));
  const found = new Map<Element, HTMLElement>();
  content.blocks.forEach((block, i) => {
    forEachCounterpart(block, clones[i], (sourceEl, cloneEl) => {
      if (targets.has(sourceEl) && cloneEl instanceof HTMLElement) found.set(sourceEl, cloneEl);
    });
  });
  return found;
};

/**
 * Wraps and zooms the captured tables and code blocks so each fits the width of its container at
 * `contentWidthPx`, writing the wrap class and `zoom` onto the captured elements: measuring and
 * rendering both clone them, so this must run before measureBlocks.
 */
export async function fitOverflow(
  content: CapturedContent,
  overrides: Readonly<Record<number, FitOverride>>,
  contentWidthPx: number,
): Promise<FitResult[]> {
  const run = (latestRun.get(content) ?? 0) + 1;
  latestRun.set(content, run);
  resetTargets(content.fits, overrides);
  if (content.fits.length === 0) return [];

  return withLaidOutClones(content, contentWidthPx, (_wiki, clones) => {
    const counterparts = cloneTargets(content, clones);
    const isLatest = latestRun.get(content) === run;
    /*
     * A flex item (a two-column layout's column) grows to the min-content of what it holds, so every
     * target that is not decided yet stays out of flow: its container is read without it, and it is
     * put back only to measure itself and then stays at its fitted width.
     */
    const restores = new Map(Array.from(counterparts.values(), (clone) => [clone, hide(clone)] as const));
    return content.fits.map(({ element, kind }, index): FitResult => {
      const override = overrides[index];
      const clone = counterparts.get(element);
      const availablePx = clone ? availableWidth(clone.parentElement) : Number.NaN;
      if (clone) restores.get(clone)?.();
      const input: FitInput = { override, availablePx, naturalPx: clone ? naturalWidth(clone) : Number.NaN };
      const decision = decideFit(input);
      // Later targets in the same container must see this one at its fitted width.
      const settled = clone ? settle(clone, decision.scale, availablePx, override?.mode === 'scale') : null;
      const scale = settled?.scale ?? decision.scale;
      if (isLatest) element.style.zoom = zoomFor(scale);
      const warning = fitWarning({ ...input, naturalPx: settled?.naturalPx ?? input.naturalPx }, { ...decision, scale });
      return { index, kind, mode: override?.mode ?? 'auto', scale, warning };
    });
  });
}
