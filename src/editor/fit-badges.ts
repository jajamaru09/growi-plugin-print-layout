import { FIT_SCALE_RANGE, FIT_SCALE_STEP } from '../constants';
import { FIT_ATTR } from '../dom-attributes';
import type { FitResult } from '../pagination';
import type { FitOverride } from './edit-state';

export interface FitBadgeOptions {
  fits: readonly FitResult[];
  overrides: Readonly<Record<number, FitOverride>>;
  /** `null` returns the target to automatic fitting. */
  onChange(fitIndex: number, override: FitOverride | null): void;
  /** Fit index whose menu opens on attach: every change re-renders the badges, and a menu left open must survive it. */
  openMenu?: number | null;
  /** Called with the fit index whose menu opened, or null when the menu closed. */
  onMenuChange?(fitIndex: number | null): void;
}

type Choice = 'auto' | 'shrink' | 'scale';

const CHOICES: readonly { choice: Choice; label: string }[] = [
  { choice: 'auto', label: '自動' },
  { choice: 'shrink', label: '縮小のみ' },
  { choice: 'scale', label: '倍率を指定' },
];
const MENU_OFFSET_PX = 24;
const SCALE_OPTIONS: readonly number[] = Array.from(
  { length: (FIT_SCALE_RANGE.max - FIT_SCALE_RANGE.min) / FIT_SCALE_STEP + 1 },
  (_, i) => FIT_SCALE_RANGE.min + i * FIT_SCALE_STEP,
);

const percentOf = (scale: number): number => Math.round(scale * 100);

/** The step options, plus a saved value off the step (spec 5.4.2 allows any integer in the range). */
const scaleOptionsWith = (percent: number): number[] =>
  SCALE_OPTIONS.includes(percent) ? [...SCALE_OPTIONS] : [...SCALE_OPTIONS, percent].sort((a, b) => a - b);

export function fitBadgeText({ mode, scale }: FitResult): string {
  if (mode === 'shrink') return `縮小のみ ${percentOf(scale)}%`;
  if (mode === 'scale') return `倍率 ${percentOf(scale)}%`;
  return scale < 1 ? `自動・縮小 ${percentOf(scale)}%` : '自動';
}

/** Initial value of the scale select: the pinned scale, else the computed one rounded down to the step. */
const defaultScalePercent = (result: FitResult, override: FitOverride | undefined): number => {
  if (override?.mode === 'scale') return override.scalePercent;
  const stepped = Math.floor((result.scale * 100) / FIT_SCALE_STEP) * FIT_SCALE_STEP;
  return Math.min(FIT_SCALE_RANGE.max, Math.max(FIT_SCALE_RANGE.min, stepped));
};

interface Entry {
  target: HTMLElement;
  badge: HTMLButtonElement;
  result: FitResult;
}

interface OpenMenu {
  entry: Entry;
  element: HTMLElement;
}

/**
 * Puts a badge on every rendered fit target (each fragment of a split one) showing how it is
 * fitted, with a menu to override it. Everything lives in a `.pl-ui` layer beside the pages,
 * so the page frames' overflow never clips it and rendered content is untouched. Returns detach.
 */
export function attachFitBadges(previewHost: HTMLElement, opts: FitBadgeOptions): () => void {
  const layer = document.createElement('div');
  layer.className = 'pl-ui pl-fit-layer';
  const entries: Entry[] = [];
  let menu: OpenMenu | null = null;

  const place = (el: HTMLElement, hostRect: DOMRect, left: number, top: number): void => {
    el.style.position = 'absolute';
    el.style.left = `${left - hostRect.left}px`;
    el.style.top = `${top - hostRect.top}px`;
  };

  /** Top-right corner of `target`; one cut off by the page edge (an overflowing fixed scale) is held at the content's right edge. */
  const cornerOf = (target: HTMLElement): { right: number; top: number } => {
    const rect = target.getBoundingClientRect();
    const content = target.closest('.pl-content');
    return { right: content == null ? rect.right : Math.min(rect.right, content.getBoundingClientRect().right), top: rect.top };
  };

  // Rects are already visual (zoom and height scaling included), so no scale math is needed here.
  function position(): void {
    const hostRect = previewHost.getBoundingClientRect();
    for (const { target, badge } of entries) {
      const { right, top } = cornerOf(target);
      place(badge, hostRect, right, top);
    }
    if (menu != null) {
      const { right, top } = cornerOf(menu.entry.target);
      place(menu.element, hostRect, right, top + MENU_OFFSET_PX);
    }
  }

  /** Removes the menu element; `notify` is false only when this layer itself is going away. */
  function closeMenu(notify = true): void {
    if (menu == null) return;
    menu.element.remove();
    menu = null;
    if (notify) opts.onMenuChange?.(null);
  }

  function commit(entry: Entry, override: FitOverride | null): void {
    closeMenu();
    opts.onChange(entry.result.index, override);
  }

  function fillMenu(element: HTMLElement, entry: Entry, current: FitOverride | undefined): void {
    const selected: Choice = current?.mode ?? 'auto';
    const name = `pl-fit-${entry.result.index}`;
    const rows = CHOICES.map(({ choice, label }) => {
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.checked = choice === selected;
      // The menu opens on the active option and is rebuilt on every switch, so a change is always a switch.
      input.addEventListener('change', () => {
        if (choice === 'auto') commit(entry, null);
        else if (choice === 'shrink') commit(entry, { mode: 'shrink' });
        else {
          // Stays open so the percent can be picked right away.
          const override: FitOverride = { mode: 'scale', scalePercent: defaultScalePercent(entry.result, current) };
          opts.onChange(entry.result.index, override);
          fillMenu(element, entry, override);
        }
      });
      const text = document.createElement('span');
      text.textContent = label;
      const row = document.createElement('label');
      row.append(input, text);
      return row;
    });
    element.replaceChildren(...rows);
    if (selected !== 'scale') return;
    const select = document.createElement('select');
    const initial = defaultScalePercent(entry.result, current);
    for (const percent of scaleOptionsWith(initial)) {
      const option = document.createElement('option');
      option.value = String(percent);
      option.textContent = `${percent}%`;
      select.appendChild(option);
    }
    select.value = String(initial);
    select.addEventListener('change', () => {
      const scalePercent = Number(select.value);
      if (current?.mode === 'scale' && current.scalePercent === scalePercent) return;
      commit(entry, { mode: 'scale', scalePercent });
    });
    element.appendChild(select);
  }

  function showMenu(entry: Entry): void {
    const element = document.createElement('div');
    element.className = 'pl-ui pl-fit-menu';
    fillMenu(element, entry, opts.overrides[entry.result.index]);
    layer.appendChild(element);
    menu = { entry, element };
    position();
  }

  function openMenu(entry: Entry): void {
    const toggledOff = menu?.entry === entry;
    closeMenu(toggledOff);
    if (toggledOff) return;
    showMenu(entry);
    opts.onMenuChange?.(entry.result.index);
  }

  const resultsByIndex = new Map(opts.fits.map((r) => [r.index, r] as const));
  for (const target of previewHost.querySelectorAll<HTMLElement>(`[${FIT_ATTR}]`)) {
    const result = resultsByIndex.get(Number(target.getAttribute(FIT_ATTR)));
    if (result == null) continue;
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = result.warning == null ? 'pl-fit-badge' : 'pl-fit-badge pl-fit-badge-warn';
    badge.textContent = fitBadgeText(result);
    const entry: Entry = { target, badge, result };
    badge.addEventListener('click', () => openMenu(entry));
    entries.push(entry);
    layer.appendChild(badge);
  }

  const onDocumentPointerDown = (e: PointerEvent): void => {
    if (menu == null || (e.target instanceof Node && layer.contains(e.target))) return;
    closeMenu();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && menu != null) closeMenu();
  };

  previewHost.appendChild(layer);
  const reopened = entries.find((e) => e.result.index === opts.openMenu);
  if (reopened != null) showMenu(reopened);
  position();
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onKeyDown);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
  observer?.observe(previewHost);
  return () => {
    observer?.disconnect();
    document.removeEventListener('pointerdown', onDocumentPointerDown);
    document.removeEventListener('keydown', onKeyDown);
    layer.remove();
  };
}
