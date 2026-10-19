import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as api from '../api/growi-page';
import { ConflictError, GrantMismatchError, GrantRejectedError, type PageRecord, PermissionError } from '../api/growi-page';
import { captureWiki, type CapturedContent, findMainWiki } from '../capture';
import { PRINT_STYLE_ID } from '../constants';
import { computeBlockAnchors, defaultLayout, type LayoutSettings } from '../layout';
import { contentBoxPx, type FitResult, fitOverflow, measureBlocks } from '../pagination';
import { loadLayout, saveLayout } from '../storage';
import type { PagePreviewProps } from './PagePreview';
import { PrintLayoutEditor } from './PrintLayoutEditor';

const preview = vi.hoisted(() => ({ props: null as PagePreviewProps | null }));
vi.mock('./PagePreview', async (orig) => {
  const actual = await orig<typeof import('./PagePreview')>();
  return {
    ...actual,
    PagePreview: (props: PagePreviewProps) => {
      preview.props = props;
      return actual.PagePreview(props);
    },
  };
});

vi.mock('../api/growi-page', async (orig) => ({
  ...(await orig<typeof import('../api/growi-page')>()),
  fetchPageById: vi.fn(),
  isLoggedIn: vi.fn(),
}));
vi.mock('../storage', async (orig) => ({
  ...(await orig<typeof import('../storage')>()),
  loadLayout: vi.fn(),
  saveLayout: vi.fn(),
}));
vi.mock('../capture', async (orig) => ({
  ...(await orig<typeof import('../capture')>()),
  findMainWiki: vi.fn(),
  captureWiki: vi.fn(),
}));
vi.mock('../pagination', async (orig) => ({
  ...(await orig<typeof import('../pagination')>()),
  measureBlocks: vi.fn(),
  fitOverflow: vi.fn(),
}));

const source: PageRecord = {
  id: 'src1',
  path: '/doc',
  revisionId: 'rev2',
  body: '',
  grant: 1,
  grantedGroups: [],
};
const layoutPage: PageRecord = { ...source, id: 'child1', path: '/doc/_print-layout', revisionId: 'c1' };

const makeContent = (): CapturedContent => {
  const root = document.createElement('div');
  root.className = 'wiki';
  root.innerHTML =
    '<h2>A</h2><p>B</p><p>C</p><p><img src="/x.png"></p><div style="display:flex"><div>L</div><div>R</div></div>';
  const img = root.querySelector('img') as HTMLElement;
  const columns = root.querySelector('div') as HTMLElement;
  return {
    root,
    blocks: Array.from(root.children) as HTMLElement[],
    images: [{ element: img, kind: 'img', key: '/x.png' }],
    columns: [{ element: columns }],
    fits: [],
  };
};

let content: CapturedContent;

/** Width the applier sets for `percent` of the default (A4 portrait) content box. */
const percentOfContentPx = (percent: number): string =>
  `${(percent * contentBoxPx(defaultLayout('src1', 'rev2').page).widthPx) / 100}px`;

const savedLayout = (over: Partial<LayoutSettings> = {}): LayoutSettings => ({
  ...defaultLayout('src1', 'rev2'),
  ...over,
});

const givenSaved = (layout: LayoutSettings | null): void => {
  vi.mocked(loadLayout).mockResolvedValue({ layout, warnings: [], layoutPage: layout ? layoutPage : null, droppedHidden: 0 });
};

const renderEditor = (onClose = vi.fn()) => render(<PrintLayoutEditor pageId="src1" onClose={onClose} />);

const ready = async (): Promise<void> => {
  await waitFor(() => expect(document.querySelector('.pl-page')).not.toBeNull());
};

const clickSave = (): void => {
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
};

beforeEach(() => {
  content = makeContent();
  vi.mocked(api.fetchPageById).mockResolvedValue(source);
  vi.mocked(api.isLoggedIn).mockResolvedValue(true);
  givenSaved(null);
  vi.mocked(findMainWiki).mockReturnValue(document.createElement('div'));
  vi.mocked(captureWiki).mockImplementation(async () => content);
  vi.mocked(fitOverflow).mockResolvedValue([]);
  vi.mocked(measureBlocks).mockImplementation(async (c) =>
    c.blocks.map((_, index) => ({ index, kind: 'other' as const, heightPx: 10 })),
  );
  vi.mocked(saveLayout).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  document.getElementById(PRINT_STYLE_ID)?.remove();
  vi.restoreAllMocks();
});

describe('PrintLayoutEditor', () => {
  test('renders the captured page into .pl-page frames and applies the print style', async () => {
    renderEditor();
    await ready();
    expect(document.querySelector('.pl-page [data-pl-block="0"]')?.textContent).toBe('A');
    expect(document.getElementById(PRINT_STYLE_ID)?.textContent).toContain('size: 210mm 297mm');
  });

  test('editor shows "適用できなかった調整: 1 件" when one saved break has no match', async () => {
    givenSaved(savedLayout({ breaks: [{ anchor: { tag: 'h3', textHash: '0000ffff', occurrence: 0 } }] }));
    renderEditor();
    expect(await screen.findByText('適用できなかった調整: 1 件')).toBeTruthy();
  });

  test('editor shows stale notice when saved sourceRevisionId differs from current revision', async () => {
    givenSaved(savedLayout({ sourceRevisionId: 'rev1' }));
    renderEditor();
    expect(await screen.findByText('前回の調整後に本文が更新されています')).toBeTruthy();
  });

  test('no stale notice when the saved revision is the current one', async () => {
    givenSaved(savedLayout());
    renderEditor();
    await ready();
    expect(screen.queryByText('前回の調整後に本文が更新されています')).toBeNull();
  });

  test('warns when the layout page is readable by more people than the source page', async () => {
    vi.mocked(api.fetchPageById).mockResolvedValue({ ...source, grant: 4 });
    givenSaved(savedLayout());
    renderEditor();
    expect(await screen.findByText('この設定ページの閲覧範囲が元ページより広くなっています')).toBeTruthy();
  });

  test('applies saved image widths and manual breaks before measuring and paginating', async () => {
    const anchors = computeBlockAnchors(content.blocks);
    givenSaved(
      savedLayout({
        breaks: [{ anchor: anchors[2] }],
        images: [{ anchor: { kind: 'img', key: '/x.png', occurrence: 0 }, widthPercent: 40 }],
      }),
    );
    renderEditor();
    await ready();
    expect((content.images[0].element as HTMLElement).style.width).toBe(percentOfContentPx(40));
    const pages = document.querySelectorAll('.pl-page');
    expect(pages).toHaveLength(2);
    expect(pages[1].querySelector('[data-pl-block]')?.getAttribute('data-pl-block')).toBe('2');
  });

  test('applies a saved column ratio to the preview, lists an edited column as unmatched and saves both', async () => {
    const [columnAnchor] = computeBlockAnchors([content.columns[0].element]);
    const edited = { anchor: { ...columnAnchor, textHash: '0000ffff' }, leftPercent: 60 };
    givenSaved(savedLayout({ columns: [{ anchor: columnAnchor, leftPercent: 30 }, edited] }));
    vi.mocked(saveLayout).mockResolvedValue(layoutPage);
    renderEditor();
    await ready();
    const rendered = document.querySelector('.pl-page [data-pl-columns="0"]') as HTMLElement;
    expect(Array.from(rendered.children).map((c) => (c as HTMLElement).style.flexGrow)).toEqual(['30', '70']);
    expect(screen.getByText('適用できなかった調整: 1 件')).toBeTruthy();

    clickSave();
    await waitFor(() => expect(saveLayout).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveLayout).mock.calls[0][1].columns).toEqual([{ anchor: columnAnchor, leftPercent: 30 }, edited]);
  });

  test('the eye button hides a heading section at once, the gray line shows it again, and the save keeps it', async () => {
    content.root.insertAdjacentHTML('beforeend', '<h2>Z</h2>');
    content.blocks = Array.from(content.root.children) as HTMLElement[];
    vi.mocked(saveLayout).mockResolvedValue(layoutPage);
    renderEditor();
    await ready();

    fireEvent.click(screen.getAllByRole('button', { name: '印刷しない: A' })[0]);
    await waitFor(() => expect(document.querySelector('.pl-page [data-pl-block="0"]')).toBeNull());
    expect(document.querySelector('.pl-page [data-pl-block="4"]')).toBeNull();
    expect(document.querySelector('.pl-page [data-pl-block="5"]')?.textContent).toBe('Z');
    expect(screen.getAllByRole('button', { name: '表示に戻す: A' }).length).toBeGreaterThan(0);

    clickSave();
    await waitFor(() => expect(saveLayout).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveLayout).mock.calls[0][1].hidden.map((h) => h.label)).toEqual(['A']);

    fireEvent.click(screen.getAllByRole('button', { name: '表示に戻す: A' })[0]);
    await waitFor(() => expect(document.querySelector('.pl-page [data-pl-block="0"]')?.textContent).toBe('A'));
    expect(screen.queryByRole('button', { name: '表示に戻す: A' })).toBeNull();
  });

  test('the heading list toggles a section through the same handler as the preview', async () => {
    content.root.insertAdjacentHTML('beforeend', '<h2>Z</h2>');
    content.blocks = Array.from(content.root.children) as HTMLElement[];
    renderEditor();
    await ready();
    const row = document.querySelector('.pl-headings li') as HTMLElement;
    fireEvent.click(row.querySelector('button') as HTMLElement);
    await waitFor(() => expect(document.querySelector('.pl-page [data-pl-block="0"]')).toBeNull());
    const hiddenRow = document.querySelector('.pl-headings li.pl-heading-hidden') as HTMLElement;
    expect(hiddenRow).not.toBeNull();
    fireEvent.click(hiddenRow.querySelector('button') as HTMLElement);
    await waitFor(() => expect(document.querySelector('.pl-page [data-pl-block="0"]')).not.toBeNull());
  });

  describe('printing with an unmatched hide setting', () => {
    const unmatchedHide = (): LayoutSettings =>
      savedLayout({
        hidden: [{ anchor: { tag: 'h2', textHash: '0000ffff', parents: [], occurrence: 0 }, label: '社内メモ' }],
      });
    const MESSAGE =
      '隠す設定のうち 1 件が本文に見つかりません。隠したつもりの内容が印刷される可能性があります。\n・社内メモ\n\nOK を押すと印刷します。';

    test('cancelling the confirm prints nothing and shows no print hint', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      givenSaved(unmatchedHide());
      renderEditor();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
      expect(confirm).toHaveBeenCalledWith(MESSAGE);
      expect(alert).not.toHaveBeenCalled();
      expect(print).not.toHaveBeenCalled();
    });

    test('accepting the confirm prints', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      givenSaved(unmatchedHide());
      renderEditor();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(print).toHaveBeenCalledTimes(1);
    });

    test('Ctrl+P is taken over and goes through the same confirm', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      givenSaved(unmatchedHide());
      renderEditor();
      await ready();
      const notPrevented = fireEvent.keyDown(document, { key: 'p', ctrlKey: true });
      expect(notPrevented).toBe(false);
      expect(confirm).toHaveBeenCalledWith(MESSAGE);
      expect(print).not.toHaveBeenCalled();
    });

    test('Cmd+P accepted in the confirm prints', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      givenSaved(unmatchedHide());
      renderEditor();
      await ready();
      fireEvent.keyDown(document, { key: 'p', metaKey: true });
      expect(print).toHaveBeenCalledTimes(1);
    });

    test('after the editor closes, Ctrl+P is left to the browser', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      givenSaved(unmatchedHide());
      const { unmount } = renderEditor();
      await ready();
      unmount();
      expect(fireEvent.keyDown(document, { key: 'p', ctrlKey: true })).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    });

    test('a saved hide that could not be read asks before printing', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      vi.mocked(loadLayout).mockResolvedValue({
        layout: savedLayout(),
        warnings: ['hidden[0] is invalid; dropped'],
        layoutPage,
        droppedHidden: 1,
      });
      renderEditor();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
      expect(confirm).toHaveBeenCalledWith(
        '保存された隠す設定の一部を読み取れませんでした。隠したつもりの内容が印刷される可能性があります。\n\nOK を押すと印刷します。',
      );
      expect(print).not.toHaveBeenCalled();
    });

    test('a layout page that could not be read asks before printing', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      vi.mocked(loadLayout).mockResolvedValue({ layout: null, warnings: ['Unsupported layout version'], layoutPage, droppedHidden: 0 });
      renderEditor();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
      expect(confirm).toHaveBeenCalledWith(
        '保存された設定を読み取れませんでした。隠す設定が反映されていない可能性があります。\n\nOK を押すと印刷します。',
      );
      expect(print).not.toHaveBeenCalled();
    });

    test('saving over a layout that could not be read retires its confirm', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      vi.spyOn(window, 'print').mockImplementation(() => undefined);
      vi.mocked(loadLayout).mockResolvedValue({ layout: null, warnings: ['Unsupported layout version'], layoutPage, droppedHidden: 0 });
      vi.mocked(saveLayout).mockResolvedValue(layoutPage);
      renderEditor();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      await screen.findByText('保存しました');
      fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
      expect(confirm).not.toHaveBeenCalled();
    });

    test('a held-down Ctrl+P asks only once', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      givenSaved(unmatchedHide());
      renderEditor();
      await ready();
      fireEvent.keyDown(document, { key: 'p', ctrlKey: true });
      expect(fireEvent.keyDown(document, { key: 'p', ctrlKey: true, repeat: true })).toBe(false);
      expect(confirm).toHaveBeenCalledTimes(1);
    });

    test('while the editor is still loading, Ctrl+P is left to the browser', () => {
      vi.mocked(loadLayout).mockReturnValue(new Promise(() => undefined));
      renderEditor();
      expect(fireEvent.keyDown(document, { key: 'p', ctrlKey: true })).toBe(true);
    });

    test('a guest who cannot save gets the same confirm', async () => {
      vi.mocked(api.isLoggedIn).mockResolvedValue(false);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      givenSaved(unmatchedHide());
      renderEditor();
      await ready();
      expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
      expect(confirm).toHaveBeenCalledWith(MESSAGE);
      expect(print).not.toHaveBeenCalled();
    });

    test('no confirm is shown without an unmatched hide setting', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      renderEditor();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
      expect(confirm).not.toHaveBeenCalled();
      expect(print).toHaveBeenCalledTimes(1);
    });
  });

  test('hiding every heading section empties the preview, disables printing and still allows saving', async () => {
    content.root.innerHTML = '<h2>A</h2><p>B</p>';
    content.blocks = Array.from(content.root.children) as HTMLElement[];
    content.images = [];
    content.columns = [];
    vi.mocked(saveLayout).mockResolvedValue(layoutPage);
    renderEditor();
    await ready();
    fireEvent.click(screen.getAllByRole('button', { name: '印刷しない: A' })[0]);
    expect(await screen.findByText('印刷する内容がありません')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'PDF に印刷' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelectorAll('.pl-page')).toHaveLength(1);
    clickSave();
    await waitFor(() => expect(saveLayout).toHaveBeenCalledTimes(1));
  });

  test('choosing a fit override from a badge re-paginates with it and saves a fits entry', async () => {
    const table = document.createElement('table');
    table.innerHTML = '<tbody><tr><td>wide</td></tr></tbody>';
    content.root.appendChild(table);
    content.blocks = Array.from(content.root.children) as HTMLElement[];
    content.fits = [{ element: table, kind: 'table' }];
    vi.mocked(fitOverflow).mockImplementation(async (_c, overrides) => [
      { index: 0, kind: 'table', mode: overrides[0]?.mode ?? 'auto', scale: 0.5, warning: null },
    ]);
    vi.mocked(saveLayout).mockResolvedValue(layoutPage);
    renderEditor();
    await ready();
    const badge = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.pl-fit-badge');
      expect(el?.textContent).toBe('自動・縮小 50%');
      return el as HTMLElement;
    });
    fireEvent.click(badge);
    const shrinkOnly = Array.from(document.querySelectorAll<HTMLInputElement>('.pl-fit-menu input[type="radio"]'))[1];
    fireEvent.click(shrinkOnly);
    await waitFor(() => expect(document.querySelector('.pl-fit-badge')?.textContent).toBe('縮小のみ 50%'));
    expect(vi.mocked(fitOverflow).mock.calls[vi.mocked(fitOverflow).mock.calls.length - 1][1]).toEqual({ 0: { mode: 'shrink' } });

    clickSave();
    await waitFor(() => expect(saveLayout).toHaveBeenCalledTimes(1));
    const [fitAnchor] = computeBlockAnchors([table]);
    expect(vi.mocked(saveLayout).mock.calls[0][1].fits).toEqual([{ anchor: fitAnchor, mode: 'shrink' }]);
  });

  test('choosing 倍率を指定 keeps its menu open through the re-pagination, so the percent can be picked next', async () => {
    const table = document.createElement('table');
    table.innerHTML = '<tbody><tr><td>wide</td></tr></tbody>';
    content.root.appendChild(table);
    content.blocks = Array.from(content.root.children) as HTMLElement[];
    content.fits = [{ element: table, kind: 'table' }];
    vi.mocked(fitOverflow).mockImplementation(async (_c, overrides) => {
      const o = overrides[0];
      return [{ index: 0, kind: 'table', mode: o?.mode ?? 'auto', scale: o?.mode === 'scale' ? o.scalePercent / 100 : 0.62, warning: null }];
    });
    renderEditor();
    await ready();
    const badge = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.pl-fit-badge');
      expect(el?.textContent).toBe('自動・縮小 62%');
      return el as HTMLElement;
    });
    fireEvent.click(badge);
    fireEvent.click(Array.from(document.querySelectorAll<HTMLInputElement>('.pl-fit-menu input[type="radio"]'))[2]);
    await waitFor(() => expect(document.querySelector('.pl-fit-badge')?.textContent).toBe('倍率 60%'));
    const select = document.querySelector<HTMLSelectElement>('.pl-fit-menu select') as HTMLSelectElement;
    expect(select.value).toBe('60');
    fireEvent.change(select, { target: { value: '85' } });
    await waitFor(() => expect(document.querySelector('.pl-fit-badge')?.textContent).toBe('倍率 85%'));
    expect(document.querySelector('.pl-fit-menu')).toBeNull();
  });

  test('switching to 横 re-paginates with the landscape page size', async () => {
    renderEditor();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '横' }));
    await waitFor(() =>
      expect(document.getElementById(PRINT_STYLE_ID)?.textContent).toContain('size: 297mm 210mm'),
    );
  });

  test('save is disabled for a guest', async () => {
    vi.mocked(api.isLoggedIn).mockResolvedValue(false);
    renderEditor();
    await ready();
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('saving stamps the current source revision, keeps unmatched entries and reuses the saved record next time', async () => {
    const orphan = { anchor: { tag: 'h3', textHash: '0000ffff', occurrence: 0 } };
    givenSaved(savedLayout({ sourceRevisionId: 'rev1', breaks: [orphan] }));
    const firstSaved = { ...layoutPage, revisionId: 'c2' };
    vi.mocked(saveLayout).mockResolvedValueOnce(firstSaved).mockResolvedValueOnce({ ...layoutPage, revisionId: 'c3' });
    renderEditor();
    await screen.findByText('前回の調整後に本文が更新されています');

    clickSave();
    await waitFor(() => expect(saveLayout).toHaveBeenCalledTimes(1));
    const [src, layout, existing] = vi.mocked(saveLayout).mock.calls[0];
    expect(src).toEqual(source);
    expect(layout).toMatchObject({ sourcePageId: 'src1', sourceRevisionId: 'rev2', breaks: [orphan] });
    expect(existing).toEqual(layoutPage);
    await waitFor(() => expect(screen.queryByText('前回の調整後に本文が更新されています')).toBeNull());
    expect(await screen.findByText('保存しました')).toBeTruthy();

    clickSave();
    await waitFor(() => expect(saveLayout).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveLayout).mock.calls[1][2]).toEqual(firstSaved);
  });

  test('editor shows conflict prompt when saveLayout rejects with ConflictError and does not call save again', async () => {
    vi.mocked(saveLayout).mockRejectedValue(new ConflictError());
    renderEditor();
    await ready();
    clickSave();
    expect(await screen.findByText('ほかの人が更新しました。再読み込みしますか？')).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(saveLayout).toHaveBeenCalledTimes(1);
  });

  test('OK on the conflict prompt reloads from the start', async () => {
    vi.mocked(saveLayout).mockRejectedValue(new ConflictError());
    renderEditor();
    await ready();
    clickSave();
    await screen.findByText('ほかの人が更新しました。再読み込みしますか？');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(api.fetchPageById).toHaveBeenCalledTimes(2));
    await ready();
    expect(loadLayout).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('ほかの人が更新しました。再読み込みしますか？')).toBeNull();
    expect(saveLayout).toHaveBeenCalledTimes(1);
  });

  test('a pagination still running when a reload starts never renders its stale layout', async () => {
    vi.mocked(saveLayout).mockRejectedValue(new ConflictError());
    renderEditor();
    await ready();
    let release: () => void = () => undefined;
    vi.mocked(measureBlocks).mockImplementationOnce(
      (c) =>
        new Promise((resolve) => {
          release = () => resolve(c.blocks.map((_, index) => ({ index, kind: 'other' as const, heightPx: 10 })));
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: '横' }));
    await waitFor(() => expect(measureBlocks).toHaveBeenCalledTimes(2));
    clickSave();
    await screen.findByText('ほかの人が更新しました。再読み込みしますか？');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await ready();
    expect(document.getElementById(PRINT_STYLE_ID)?.textContent).toContain('size: 210mm 297mm');
  });

  test('printing before the preview is ready only shows a notice', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    vi.mocked(measureBlocks).mockImplementation(() => new Promise(() => undefined));
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'PDF に印刷' }));
    expect(await screen.findByText('プレビューの準備中です。準備ができたら印刷します')).toBeTruthy();
    expect(print).not.toHaveBeenCalled();
  });

  test('a failed pagination is reported and printing is refused with the failure', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    vi.mocked(measureBlocks).mockRejectedValue(new Error('boom'));
    renderEditor();
    expect(await screen.findByText('プレビューの作成に失敗しました: boom')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
    expect(screen.getByText('プレビューの作成に失敗しました: boom')).toBeTruthy();
    expect(print).not.toHaveBeenCalled();
  });

  test('printing while a margin change waits for its debounce lays out the new margin first', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const printedStyles: string[] = [];
    vi.spyOn(window, 'print').mockImplementation(() => {
      printedStyles.push((document.querySelector('.pl-page') as HTMLElement | null)?.style.paddingTop ?? '');
    });
    renderEditor();
    await ready();
    vi.useFakeTimers();
    vi.mocked(fitOverflow).mockClear();
    vi.mocked(measureBlocks).mockClear();
    fireEvent.change(screen.getByLabelText('上'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
    expect(fitOverflow).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(printedStyles).toHaveLength(1);
    expect(printedStyles[0]).toBe('40mm');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(measureBlocks).toHaveBeenCalledTimes(1);
  });

  test('printing while a pagination is still measuring waits for it', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const printedStyles: string[] = [];
    vi.spyOn(window, 'print').mockImplementation(() => {
      printedStyles.push(document.getElementById(PRINT_STYLE_ID)?.textContent ?? '');
    });
    renderEditor();
    await ready();
    let release: () => void = () => undefined;
    vi.mocked(fitOverflow).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: '横' }));
    fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
    expect(printedStyles).toHaveLength(0);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(printedStyles).toHaveLength(1));
    expect(printedStyles[0]).toContain('size: 297mm 210mm');
  });

  test('a print waiting for a pagination that hides everything prints nothing', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    content.root.innerHTML = '<h2>A</h2><p>B</p>';
    content.blocks = Array.from(content.root.children) as HTMLElement[];
    content.images = [];
    content.columns = [];
    renderEditor();
    await ready();
    let release: () => void = () => undefined;
    vi.mocked(fitOverflow).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );
    fireEvent.click(screen.getAllByRole('button', { name: '印刷しない: A' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
    expect(screen.getByText('プレビューの準備中です。準備ができたら印刷します')).toBeTruthy();
    await act(async () => {
      release();
    });
    expect(await screen.findByText('印刷する内容がありません')).toBeTruthy();
    expect(print).not.toHaveBeenCalled();
    expect(screen.queryByText('プレビューの準備中です。準備ができたら印刷します')).toBeNull();
  });

  test('two quick margin changes are measured once, after the debounce', async () => {
    renderEditor();
    await ready();
    vi.useFakeTimers();
    vi.mocked(measureBlocks).mockClear();
    fireEvent.change(screen.getByLabelText('上'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('上'), { target: { value: '25' } });
    expect(measureBlocks).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(measureBlocks).toHaveBeenCalledTimes(1);
  });

  test('discrete actions (orientation, add break) re-paginate without waiting for the debounce', async () => {
    renderEditor();
    await ready();
    vi.useFakeTimers();
    vi.mocked(fitOverflow).mockClear();
    fireEvent.click(screen.getByRole('button', { name: '横' }));
    expect(fitOverflow).toHaveBeenCalledTimes(1);
    act(() => preview.props?.handlers.onAddBreak(2));
    expect(fitOverflow).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.querySelectorAll('.pl-page')).toHaveLength(2);
  });

  test('the fit pass runs with the fit overrides before measuring, and the view carries its results', async () => {
    const fits: FitResult[] = [{ index: 0, kind: 'table', mode: 'auto', scale: 0.5, warning: 'small' }];
    vi.mocked(fitOverflow).mockResolvedValue(fits);
    renderEditor();
    await ready();
    const { widthPx } = contentBoxPx(defaultLayout('src1', 'rev2').page);
    expect(fitOverflow).toHaveBeenCalledWith(content, {}, widthPx);
    const fitOrder = vi.mocked(fitOverflow).mock.invocationCallOrder[0];
    expect(fitOrder).toBeLessThan(vi.mocked(measureBlocks).mock.invocationCallOrder[0]);
    await waitFor(() => expect(preview.props?.view?.fits).toEqual(fits));
  });

  test('the image handlers set and reset a width that is applied before measuring', async () => {
    renderEditor();
    await ready();
    const img = content.images[0].element as HTMLElement;
    act(() => preview.props?.handlers.onResizeImage(0, 30));
    await waitFor(() => expect(img.style.width).toBe(percentOfContentPx(30)));
    act(() => preview.props?.handlers.onResetImageSize(0));
    await waitFor(() => expect(img.style.width).toBe(''));
  });

  test('the saved notice disappears on the next edit', async () => {
    vi.mocked(saveLayout).mockResolvedValue(layoutPage);
    renderEditor();
    await ready();
    clickSave();
    await screen.findByText('保存しました');
    fireEvent.click(screen.getByRole('button', { name: '横' }));
    expect(screen.queryByText('保存しました')).toBeNull();
  });

  test('editor shows "保存する権限がありません" on PermissionError', async () => {
    vi.mocked(saveLayout).mockRejectedValue(new PermissionError());
    renderEditor();
    await ready();
    clickSave();
    expect(await screen.findByText('保存する権限がありません')).toBeTruthy();
  });

  test('a grant mismatch shows its message and the saved record is used for the next save', async () => {
    const landed = { ...layoutPage, revisionId: 'c9', grant: 1 };
    vi.mocked(saveLayout).mockRejectedValueOnce(new GrantMismatchError(landed)).mockResolvedValueOnce(landed);
    renderEditor();
    await ready();
    clickSave();
    expect(await screen.findByText(new GrantMismatchError(landed).message)).toBeTruthy();
    clickSave();
    await waitFor(() => expect(saveLayout).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveLayout).mock.calls[1][2]).toEqual(landed);
  });

  test('a refused grant shows the grant message, not the permission one, and keeps the loaded record', async () => {
    givenSaved(savedLayout());
    vi.mocked(saveLayout).mockRejectedValueOnce(new GrantRejectedError('/doc/_print-layout')).mockResolvedValueOnce(layoutPage);
    renderEditor();
    await ready();
    clickSave();
    const message = new GrantRejectedError('/doc/_print-layout').message;
    expect(message).toContain('元ページと同じ閲覧権限で保存できません');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText('保存する権限がありません')).toBeNull();
    clickSave();
    await waitFor(() => expect(saveLayout).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveLayout).mock.calls[1][2]).toEqual(layoutPage);
  });

  test('other save errors are shown with a prefix', async () => {
    vi.mocked(saveLayout).mockRejectedValue(new Error('HTTP 500'));
    renderEditor();
    await ready();
    clickSave();
    expect(await screen.findByText('保存に失敗しました: HTTP 500')).toBeTruthy();
  });

  test('自動に戻す clears every adjustment, unmatched ones included, without saving', async () => {
    const anchors = computeBlockAnchors(content.blocks);
    givenSaved(
      savedLayout({
        breaks: [{ anchor: anchors[2] }, { anchor: { tag: 'h3', textHash: '0000ffff', occurrence: 0 } }],
      }),
    );
    renderEditor();
    await waitFor(() => expect(document.querySelectorAll('.pl-page')).toHaveLength(2));
    expect(screen.getByText('適用できなかった調整: 1 件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '自動に戻す' }));
    await waitFor(() => expect(document.querySelectorAll('.pl-page')).toHaveLength(1));
    expect(screen.getByText('適用できなかった調整: 0 件')).toBeTruthy();
    expect(saveLayout).not.toHaveBeenCalled();
  });

  test('PDF に印刷 shows the dialog hint only the first time, then prints', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderEditor();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
    fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('印刷ダイアログで「余白: なし」「背景のグラフィック: オン」を選んでください');
    expect(print).toHaveBeenCalledTimes(2);
  });

  test('閉じる calls onClose', async () => {
    const onClose = vi.fn();
    renderEditor(onClose);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('shows a message when the source page cannot be fetched', async () => {
    vi.mocked(api.fetchPageById).mockResolvedValue(null);
    renderEditor();
    expect(await screen.findByText('元ページを読み込めませんでした')).toBeTruthy();
  });

  test('shows a message when the page body is not found', async () => {
    vi.mocked(findMainWiki).mockReturnValue(null);
    renderEditor();
    expect(await screen.findByText('本文が見つかりませんでした')).toBeTruthy();
  });

  test('unmounting before the load finishes renders nothing and adds no print style', async () => {
    let release: (c: CapturedContent) => void = () => undefined;
    vi.mocked(captureWiki).mockImplementation(
      () =>
        new Promise<CapturedContent>((resolve) => {
          release = resolve;
        }),
    );
    const { unmount } = renderEditor();
    await waitFor(() => expect(captureWiki).toHaveBeenCalled());
    unmount();
    await act(async () => {
      release(content);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(measureBlocks).not.toHaveBeenCalled();
    expect(document.getElementById(PRINT_STYLE_ID)).toBeNull();
  });
});
