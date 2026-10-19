import {
  createPage,
  fetchPageById,
  fetchPageByPath,
  GrantMismatchError,
  GrantRejectedError,
  type PageRecord,
  updatePage,
} from '../api/growi-page';
import { extractLayoutJson, type LayoutSettings, parseLayout, serializeLayoutPage } from '../layout';
import { hasSameGrant } from './grant-check';

export const LAYOUT_PAGE_NAME = '_print-layout';

export interface LoadedLayout {
  layout: LayoutSettings | null;
  warnings: string[];
  layoutPage: PageRecord | null;
  /** Saved hide entries that could not be read. */
  droppedHidden: number;
}

export function layoutPagePath(sourcePath: string): string {
  const base = sourcePath.replace(/\/+$/, '');
  return `${base}/${LAYOUT_PAGE_NAME}`;
}

export async function loadLayout(source: PageRecord): Promise<LoadedLayout> {
  const layoutPage = await fetchPageByPath(layoutPagePath(source.path));
  if (layoutPage == null) return { layout: null, warnings: [], layoutPage: null, droppedHidden: 0 };

  const json = extractLayoutJson(layoutPage.body);
  if (json == null) {
    return { layout: null, warnings: ['保存された設定を読み取れませんでした'], layoutPage, droppedHidden: 0 };
  }
  const { layout, warnings, droppedHidden } = parseLayout(json);
  return { layout, warnings, layoutPage, droppedHidden };
}

/**
 * Conflicts are rethrown as-is; the caller decides how to resolve them. A child that cannot have
 * the source page's grant is refused before writing (GrantRejectedError), or reported after the
 * write if it still ended up with another grant (GrantMismatchError).
 */
export async function saveLayout(
  source: PageRecord,
  layout: LayoutSettings,
  existing: PageRecord | null,
): Promise<PageRecord> {
  const body = serializeLayoutPage(layout);
  const saved =
    existing == null
      ? await createPage(layoutPagePath(source.path), body, source)
      : await updateMatchingChild(source, existing, body);

  // The write already landed, so a failed or empty re-fetch falls back to the write response
  // (POST/PUT responses carry grant and grantedGroups).
  const child = (await fetchPageById(saved.id).catch(() => null)) ?? saved;
  if (!hasSameGrant(source, child)) throw new GrantMismatchError(child);
  return child;
}

/** An update keeps the child's grant, so the grant is checked as it is now, before writing. */
async function updateMatchingChild(source: PageRecord, existing: PageRecord, body: string): Promise<PageRecord> {
  const current = (await fetchPageById(existing.id).catch(() => null)) ?? existing;
  if (!hasSameGrant(source, current)) throw new GrantRejectedError(current.path);
  return updatePage(existing.id, existing.revisionId, body);
}
