import { fetchPageById, isLoggedIn, type PageRecord } from '../api/growi-page';
import { type CapturedContent, captureWiki, findMainWiki, toStaticDrawioSvg } from '../capture';
import { computeBlockAnchors, computeHeadings, computeImageAnchors } from '../layout';
import { log } from '../log';
import { isGrantWider, loadLayout } from '../storage';
import { type ContentAnchors, type EditState, restoreState } from './edit-state';

export interface EditorData {
  source: PageRecord;
  canSave: boolean;
  /** The layout page as last read or written; null until it exists. */
  layoutPage: PageRecord | null;
  content: CapturedContent;
  anchors: ContentAnchors;
  initialState: EditState;
  staleRevision: boolean;
  grantWarning: boolean;
  warnings: string[];
  /** Saved hide entries that could not be read. */
  droppedHidden: number;
  /** A layout page exists but could not be read, so which sections were hidden is unknown. */
  layoutUnreadable: boolean;
}

export type LoadResult = { ok: true; data: EditorData } | { ok: false; message: string };

/** Validation warnings are English diagnostics; the UI gets a Japanese summary and the log the details. */
const toUserWarnings = (layoutMissing: boolean, layoutPage: PageRecord | null, warnings: string[]): string[] => {
  if (warnings.length > 0) log('loadLayout warnings:', warnings);
  if (layoutMissing && layoutPage != null) return ['保存された設定を読み取れませんでした'];
  return warnings.length > 0 ? ['保存された設定の一部が不正なため、無視しました'] : [];
};

/**
 * Fetches the source and its saved layout, captures the page body and maps the
 * saved adjustments onto it. Returns null once `isCancelled()` turns true.
 */
export async function loadEditorData(pageId: string, isCancelled: () => boolean): Promise<LoadResult | null> {
  const source = await fetchPageById(pageId);
  if (isCancelled()) return null;
  if (source == null) return { ok: false, message: '元ページを読み込めませんでした' };

  const [loggedIn, loaded] = await Promise.all([isLoggedIn(), loadLayout(source)]);
  if (isCancelled()) return null;

  const wiki = findMainWiki(document);
  if (wiki == null) {
    log('openEditor: main .wiki not found');
    return { ok: false, message: '本文が見つかりませんでした' };
  }
  const content = await captureWiki(wiki, toStaticDrawioSvg);
  if (isCancelled()) return null;

  const anchors: ContentAnchors = {
    blocks: computeBlockAnchors(content.blocks),
    images: computeImageAnchors(content.images),
    columns: computeBlockAnchors(content.columns.map((c) => c.element)),
    fits: computeBlockAnchors(content.fits.map((f) => f.element)),
    headings: computeHeadings(content.blocks),
  };
  return {
    ok: true,
    data: {
      source,
      canSave: loggedIn,
      layoutPage: loaded.layoutPage,
      content,
      anchors,
      initialState: restoreState(loaded.layout, anchors),
      staleRevision: loaded.layout != null && loaded.layout.sourceRevisionId !== source.revisionId,
      grantWarning: loaded.layoutPage != null && isGrantWider(source, loaded.layoutPage),
      warnings: toUserWarnings(loaded.layout == null, loaded.layoutPage, loaded.warnings),
      droppedHidden: loaded.droppedHidden,
      layoutUnreadable: loaded.layoutPage != null && loaded.layout == null,
    },
  };
}
