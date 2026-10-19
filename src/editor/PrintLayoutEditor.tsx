import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConflictError, GrantMismatchError, GrantRejectedError, type PageRecord, PermissionError } from '../api/growi-page';
import type { HeadingInfo, PageSetup } from '../layout';
import { log } from '../log';
import { isGrantWider, saveLayout } from '../storage';
import {
  addBreak,
  type EditState,
  moveBreak,
  removeBreak,
  removeUnmatched,
  resetColumnRatio,
  resetFitOverride,
  resetImageWidth,
  resetToAuto,
  setColumnRatio,
  setFitOverride,
  setHidden,
  setImageWidth,
  toLayout,
} from './edit-state';
import { computeCoveredBy } from './covered-by';
import { type EditorData, loadEditorData } from './load-editor';
import { PagePreview, type PreviewHandlers } from './PagePreview';
import { hiddenFitIndexes } from './paginate-visible';
import { isPrintShortcut, printConfirmMessage } from './print-guard';
import { SettingsPanel } from './SettingsPanel';
import { usePagination } from './use-pagination';
import './editor.css';

const PRINT_HINT = '印刷ダイアログで「余白: なし」「背景のグラフィック: オン」を選んでください';
const PRINT_WAITING = 'プレビューの準備中です。準備ができたら印刷します';
const CONFLICT_PROMPT = 'ほかの人が更新しました。再読み込みしますか？';

type Phase = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; data: EditorData };
type Status = { kind: 'info' | 'error'; text: string } | { kind: 'conflict' };

const NO_HEADINGS: readonly HeadingInfo[] = [];
const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** GrantMismatchError is handled by the caller: its save landed. */
const saveErrorText = (e: unknown): string => {
  if (e instanceof PermissionError) return '保存する権限がありません';
  if (e instanceof GrantRejectedError) return e.message;
  return `保存に失敗しました: ${errorMessage(e)}`;
};

const previewFailedText = (message: string): string => `プレビューの作成に失敗しました: ${message}`;

/** Typed numbers are debounced; every other setup change is a discrete action. */
const isMarginOnlyChange = (prev: PageSetup, next: PageSetup): boolean =>
  prev.size === next.size && prev.orientation === next.orientation && prev.margin !== next.margin;

const StatusMessage = ({ status, onReload, onDismiss }: { status: Status; onReload(): void; onDismiss(): void }) => {
  if (status.kind === 'conflict') {
    return (
      <div className="pl-status pl-status-error" role="alert">
        <p>{CONFLICT_PROMPT}</p>
        <div className="pl-status-actions">
          <button type="button" onClick={onReload}>
            OK
          </button>
          <button type="button" onClick={onDismiss}>
            キャンセル
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`pl-status pl-status-${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
      <p>{status.text}</p>
    </div>
  );
};

export const PrintLayoutEditor = ({ pageId, onClose }: { pageId: string; onClose: () => void }) => {
  const [loadCount, setLoadCount] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [edit, setEdit] = useState<EditState | null>(null);
  const [existing, setExisting] = useState<PageRecord | null>(null);
  const [staleRevision, setStaleRevision] = useState(false);
  const [grantWarning, setGrantWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [printRequested, setPrintRequested] = useState(false);
  // A successful save rewrites the layout page, so what could not be read at load is gone from it.
  const [readIssuesSaved, setReadIssuesSaved] = useState(false);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const printHintShownRef = useRef(false);
  const debounceNextRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Step 1-4: fetch, capture and match, once per load.
  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: 'loading' });
    setEdit(null);
    setPrintRequested(false);
    setReadIssuesSaved(false);
    loadEditorData(pageId, () => cancelled)
      .then((result) => {
        if (result == null || cancelled) return;
        if (!result.ok) {
          setPhase({ kind: 'failed', message: result.message });
          return;
        }
        const { data } = result;
        setPhase({ kind: 'ready', data });
        setEdit(data.initialState);
        setExisting(data.layoutPage);
        setStaleRevision(data.staleRevision);
        setGrantWarning(data.grantWarning);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        log('PrintLayoutEditor: load failed:', e);
        setPhase({ kind: 'failed', message: `読み込みに失敗しました: ${errorMessage(e)}` });
      });
    return () => {
      cancelled = true;
    };
  }, [pageId, loadCount]);

  const data = phase.kind === 'ready' ? phase.data : null;
  const headings = data?.anchors.headings ?? NO_HEADINGS;

  // Step 5-9 run in usePagination whenever `edit` changes.
  const onPaginationError = useCallback((message: string, e: unknown) => {
    log('PrintLayoutEditor: pagination failed:', e);
    setStatus({ kind: 'error', text: previewFailedText(message) });
  }, []);
  const pagination = usePagination(data?.content ?? null, edit, headings, debounceNextRef, onPaginationError);
  const { view } = pagination;

  // A later successful layout retires the failure notice.
  useEffect(() => {
    if (pagination.error != null) return;
    setStatus((st) => (st?.kind === 'error' && st.text.startsWith(previewFailedText('')) ? null : st));
  }, [pagination.error]);

  const update = useCallback((change: (s: EditState) => EditState, debounce = false) => {
    debounceNextRef.current = debounce;
    setStatus((st) => (st?.kind === 'info' ? null : st));
    setEdit((s) => (s == null ? s : change(s)));
  }, []);

  const blockCount = data?.content.blocks.length ?? 0;
  const headingBlocks = useMemo(() => new Set(headings.map((h) => h.blockIndex)), [headings]);
  const handlers = useMemo<PreviewHandlers>(
    () => ({
      onAddBreak: (blockIndex) => update((s) => addBreak(s, blockIndex, blockCount)),
      onMoveBreak: (from, to) => update((s) => moveBreak(s, from, to, blockCount)),
      onRemoveBreak: (blockIndex) => update((s) => removeBreak(s, blockIndex)),
      onResizeImage: (imageIndex, widthPercent) => update((s) => setImageWidth(s, imageIndex, widthPercent)),
      onResetImageSize: (imageIndex) => update((s) => resetImageWidth(s, imageIndex)),
      onSetColumnRatio: (columnIndex, leftPercent) => update((s) => setColumnRatio(s, columnIndex, leftPercent)),
      onResetColumnRatio: (columnIndex) => update((s) => resetColumnRatio(s, columnIndex)),
      onChangeFit: (fitIndex, override) =>
        update((s) => (override == null ? resetFitOverride(s, fitIndex) : setFitOverride(s, fitIndex, override))),
      onHide: (headingBlockIndex) => update((s) => setHidden(s, headingBlockIndex, true, headingBlocks)),
      onShow: (headingBlockIndex) => update((s) => setHidden(s, headingBlockIndex, false, headingBlocks)),
    }),
    [update, blockCount, headingBlocks],
  );

  const hiddenSet = useMemo(() => new Set(edit?.hidden ?? []), [edit?.hidden]);
  const hiddenRanges = view?.hidden.ranges;
  const coveredBy = useMemo(
    () => computeCoveredBy(headings, hiddenSet, hiddenRanges ?? []),
    [headings, hiddenSet, hiddenRanges],
  );

  const hiddenFits = useMemo(() => (view == null ? undefined : hiddenFitIndexes(view.content, view.hidden.blocks)), [view]);

  const onSetupChange = (setup: PageSetup): void => {
    if (edit == null) return;
    update((s) => ({ ...s, setup }), isMarginOnlyChange(edit.setup, setup));
  };

  const reload = (): void => {
    setStatus(null);
    setLoadCount((c) => c + 1);
  };

  const save = async (): Promise<void> => {
    if (data == null || edit == null || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setStatus(null);
    const layout = toLayout(edit, data.anchors, data.source);
    try {
      const saved = await saveLayout(data.source, layout, existing);
      if (!mountedRef.current) return;
      setExisting(saved);
      setStaleRevision(false);
      setGrantWarning(false);
      setReadIssuesSaved(true);
      setStatus({ kind: 'info', text: '保存しました' });
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      log('PrintLayoutEditor: save failed:', e);
      if (e instanceof GrantMismatchError) {
        setExisting(e.page);
        setStaleRevision(false);
        setGrantWarning(isGrantWider(data.source, e.page));
        setStatus({ kind: 'error', text: e.message });
      } else if (e instanceof ConflictError) {
        setStatus({ kind: 'conflict' });
      } else {
        setStatus({ kind: 'error', text: saveErrorText(e) });
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const printNow = (): void => {
    if (!printHintShownRef.current) {
      printHintShownRef.current = true;
      window.alert(PRINT_HINT);
    }
    window.print();
  };

  // Never print a layout older than the settings: a waiting run is started now and printing follows it.
  const print = (): void => {
    const confirmMessage = printConfirmMessage({
      unmatchedLabels: edit?.unmatched.hidden.map((entry) => entry.label) ?? [],
      droppedHidden: readIssuesSaved ? 0 : (data?.droppedHidden ?? 0),
      layoutUnreadable: !readIssuesSaved && (data?.layoutUnreadable ?? false),
    });
    if (confirmMessage != null && !window.confirm(confirmMessage)) return;
    if (pagination.isBusy()) {
      pagination.flush();
      setPrintRequested(true);
      setStatus({ kind: 'info', text: PRINT_WAITING });
      return;
    }
    if (pagination.error != null) {
      setStatus({ kind: 'error', text: previewFailedText(pagination.error) });
      return;
    }
    if (view == null) {
      setStatus({ kind: 'info', text: PRINT_WAITING });
      return;
    }
    if (view.isEmpty) return;
    printNow();
  };

  const printRef = useRef(print);
  printRef.current = print;
  const readyRef = useRef(false);
  readyRef.current = data != null && edit != null;

  // A keyboard print must not skip the unmatched-hide confirmation (the browser menu still can; see README).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Before the preview exists the browser prints the page itself, which applies no hides.
      if (!isPrintShortcut(e) || !readyRef.current) return;
      e.preventDefault();
      if (!e.repeat) printRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Runs after PagePreview's layout effect has rendered the published view.
  useEffect(() => {
    if (!printRequested || pagination.isBusy()) return;
    setPrintRequested(false);
    setStatus((st) => (st?.kind === 'info' && st.text === PRINT_WAITING ? null : st));
    // The panel already says 印刷する内容がありません for an empty view.
    if (pagination.error == null && view != null && !view.isEmpty) printNow();
  }, [printRequested, view, pagination.error]);

  const statusView = status && <StatusMessage status={status} onReload={reload} onDismiss={() => setStatus(null)} />;

  if (data == null || edit == null) {
    return (
      <div className="pl-editor">
        <div className="pl-ui pl-sidebar">
          <aside className="pl-panel">
            <p className="pl-section">{phase.kind === 'failed' ? phase.message : '読み込み中…'}</p>
            <section className="pl-section pl-actions">
              <button type="button" onClick={onClose}>
                閉じる
              </button>
            </section>
          </aside>
        </div>
        <main className="pl-preview" />
      </div>
    );
  }

  return (
    <div className="pl-editor">
      <div className="pl-ui pl-sidebar">
        <SettingsPanel
          setup={edit.setup}
          onSetupChange={onSetupChange}
          onReset={() => update(resetToAuto)}
          unmatched={edit.unmatched}
          headings={headings}
          hidden={hiddenSet}
          coveredBy={coveredBy}
          onToggleHeading={(blockIndex, hide) => update((s) => setHidden(s, blockIndex, hide, headingBlocks))}
          nothingToPrint={view?.isEmpty ?? false}
          fits={view?.fits ?? []}
          hiddenFits={hiddenFits}
          onRemoveUnmatched={(kind, index) => update((s) => removeUnmatched(s, kind, index))}
          warnings={data.warnings}
          staleRevision={staleRevision}
          grantWarning={grantWarning}
          canSave={data.canSave}
          saving={saving}
          onSave={() => {
            void save();
          }}
          onPrint={print}
          onClose={onClose}
        />
        {statusView}
      </div>
      <PagePreview view={view} manualBreaks={edit.breaks} fitOverrides={edit.fitOverrides} headings={headings} handlers={handlers} />
    </div>
  );
};
