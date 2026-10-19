import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CapturedContent } from '../capture';
import type { HeadingInfo, PageSetup } from '../layout';
import type { HiddenLayout } from './paginate-visible';
import { type FitResult, type Page, renderPages } from '../pagination';
import { applyPrintStyle, removePrintStyle } from '../print';
import { attachColumnRatioHandles } from './column-ratio-handles';
import type { FitOverride } from './edit-state';
import { attachFitBadges } from './fit-badges';
import { attachHideControls } from './hide-controls';
import { attachImageResizeHandles } from './image-resize-handles';
import { attachPageBreakHandles } from './page-break-handles';

/** State updates the drag handles (break lines, image corners, column dividers) will call. */
export interface PreviewHandlers {
  onAddBreak(blockIndex: number): void;
  onMoveBreak(fromBlockIndex: number, toBlockIndex: number): void;
  onRemoveBreak(blockIndex: number): void;
  onResizeImage(imageIndex: number, widthPercent: number): void;
  onResetImageSize(imageIndex: number): void;
  onSetColumnRatio(columnIndex: number, leftPercent: number): void;
  onResetColumnRatio(columnIndex: number): void;
  /** `null` returns the fit target to automatic. */
  onChangeFit(fitIndex: number, override: FitOverride | null): void;
  onHide(headingBlockIndex: number): void;
  onShow(headingBlockIndex: number): void;
}

export interface PaginatedView {
  content: CapturedContent;
  pages: readonly Page[];
  setup: PageSetup;
  /** One per captured fit target, as the fit pass of this layout left it. */
  fits: readonly FitResult[];
  hidden: HiddenLayout;
  /** True when every block is hidden; `pages` is then one page without placements. */
  isEmpty: boolean;
}

export interface PagePreviewProps {
  view: PaginatedView | null;
  manualBreaks: readonly number[];
  fitOverrides: Readonly<Record<number, FitOverride>>;
  /** Heading blocks of `view.content`. */
  headings: readonly HeadingInfo[];
  handlers: PreviewHandlers;
}

export const PagePreview = ({ view, manualBreaks, fitOverrides, headings, handlers }: PagePreviewProps) => {
  // renderPages owns this element's children; React never renders into it.
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host == null || view == null) return;
    renderPages(host, view.content, view.pages, view.setup);
    applyPrintStyle(view.setup);
  }, [view]);

  // The overlay is rebuilt after every render; detach runs before the next one.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host == null || view == null) return;
    return attachPageBreakHandles(
      host,
      new Set(manualBreaks),
      { onAdd: handlers.onAddBreak, onMove: handlers.onMoveBreak, onRemove: handlers.onRemoveBreak },
    );
  }, [view, manualBreaks, handlers]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host == null || view == null) return;
    return attachImageResizeHandles(host, { onResize: handlers.onResizeImage, onResetSize: handlers.onResetImageSize });
  }, [view, handlers]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host == null || view == null) return;
    return attachColumnRatioHandles(host, {
      onSetRatio: handlers.onSetColumnRatio,
      onResetRatio: handlers.onResetColumnRatio,
    });
  }, [view, handlers]);

  // Fit indexes count targets in one captured content, so an open menu is kept only while it is the same.
  const openFitMenuRef = useRef<{ content: CapturedContent; index: number } | null>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host == null || view == null) return;
    const open = openFitMenuRef.current;
    return attachFitBadges(host, {
      fits: view.fits,
      overrides: fitOverrides,
      onChange: handlers.onChangeFit,
      openMenu: open?.content === view.content ? open.index : null,
      onMenuChange: (index) => {
        openFitMenuRef.current = index == null ? null : { content: view.content, index };
      },
    });
  }, [view, fitOverrides, handlers]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host == null || view == null) return;
    return attachHideControls(host, {
      headings,
      outermost: view.hidden.outermost,
      onHide: handlers.onHide,
      onShow: handlers.onShow,
    });
  }, [view, headings, handlers]);

  useEffect(() => removePrintStyle, []);

  return (
    <main className="pl-preview">
      <div className="pl-pages" ref={hostRef} />
    </main>
  );
};
