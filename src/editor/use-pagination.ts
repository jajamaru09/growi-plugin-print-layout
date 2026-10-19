import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CapturedContent } from '../capture';
import { contentBoxPx, fitOverflow, measureBlocks } from '../pagination';
import { createColumnRatioApplier } from './column-ratios';
import type { HeadingInfo } from '../layout';
import type { EditState } from './edit-state';
import { createImageWidthApplier } from './image-widths';
import { paginateVisible } from './paginate-visible';
import type { PaginatedView } from './PagePreview';

export const REPAGINATE_DEBOUNCE_MS = 300;

export interface Pagination {
  /** The latest finished layout of `content`, or null before the first one. */
  view: PaginatedView | null;
  /** Message of the latest run's failure; cleared by the next success. */
  error: string | null;
  /** True while a run is waiting for its debounce or still measuring. */
  isBusy(): boolean;
  /** Starts a run that is waiting for its debounce right away. */
  flush(): void;
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface Appliers {
  widths(widths: EditState['imageWidths'], contentWidthPx: number): void;
  ratios(ratios: EditState['columnRatios']): void;
}

async function paginateContent(
  content: CapturedContent,
  headings: readonly HeadingInfo[],
  apply: Appliers,
  state: EditState,
): Promise<PaginatedView> {
  const box = contentBoxPx(state.setup);
  apply.widths(state.imageWidths, box.widthPx);
  apply.ratios(state.columnRatios);
  const fits = await fitOverflow(content, state.fitOverrides, box.widthPx);
  const blocks = await measureBlocks(content, box.widthPx);
  const { pages, hidden, isEmpty } = paginateVisible(
    blocks,
    headings,
    new Set(state.hidden),
    box.heightPx,
    new Set(state.breaks),
  );
  return { content, pages, setup: state.setup, fits, hidden, isEmpty };
}

/**
 * Re-measures and re-paginates `content` whenever `edit` changes. A change is
 * debounced when `debounceNextRef` was set for it (and a layout already
 * exists); otherwise it runs at once. Only the newest run may publish.
 */
export function usePagination(
  content: CapturedContent | null,
  edit: EditState | null,
  headings: readonly HeadingInfo[],
  debounceNextRef: MutableRefObject<boolean>,
  onError: (message: string, e: unknown) => void,
): Pagination {
  const [view, setView] = useState<PaginatedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const appliers = useMemo<Appliers | null>(
    () =>
      content
        ? { widths: createImageWidthApplier(content.images), ratios: createColumnRatioApplier(content.columns) }
        : null,
    [content],
  );
  const currentView = view != null && view.content === content ? view : null;
  const hasViewRef = useRef(false);
  hasViewRef.current = currentView != null;
  const runRef = useRef(0);
  const inFlightRef = useRef(0);
  const pendingRef = useRef<{ timer: number; start: () => void } | null>(null);
  const mountedRef = useRef(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const debounce = debounceNextRef.current && hasViewRef.current;
    debounceNextRef.current = false;
    if (content == null || appliers == null || edit == null) return;
    const run = ++runRef.current;
    const isCurrent = (): boolean => mountedRef.current && run === runRef.current;
    const start = (): void => {
      pendingRef.current = null;
      inFlightRef.current = run;
      setError(null);
      paginateContent(content, headings, appliers, edit)
        .then((next) => {
          if (!isCurrent()) return;
          inFlightRef.current = 0;
          setError(null);
          setView(next);
        })
        .catch((e: unknown) => {
          if (!isCurrent()) return;
          inFlightRef.current = 0;
          const message = errorMessage(e);
          setError(message);
          onErrorRef.current(message, e);
        });
    };
    let timer: number | undefined;
    if (debounce) {
      timer = window.setTimeout(start, REPAGINATE_DEBOUNCE_MS);
      pendingRef.current = { timer, start };
    } else {
      start();
    }
    // Cleanup invalidates this run whether it is waiting or in flight (new edit, reload, unmount).
    return () => {
      window.clearTimeout(timer);
      if (pendingRef.current?.timer === timer) pendingRef.current = null;
      if (inFlightRef.current === run) inFlightRef.current = 0;
      runRef.current += 1;
    };
  }, [content, appliers, edit, headings, debounceNextRef]);

  const isBusy = useCallback(() => pendingRef.current != null || inFlightRef.current !== 0, []);
  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (pending == null) return;
    window.clearTimeout(pending.timer);
    pending.start();
  }, []);

  return { view: currentView, error, isBusy, flush };
}
