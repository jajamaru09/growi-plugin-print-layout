import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defaultLayout } from '../layout';
import type { BreakEntry, ColumnEntry, FitEntry, ImageEntry, PageSetup } from '../layout';
import type { FitResult } from '../pagination';
import { SettingsPanel, type SettingsPanelProps } from './SettingsPanel';

const A4: PageSetup = defaultLayout('p', 'r').page;

const props = (over: Partial<SettingsPanelProps> = {}): SettingsPanelProps => ({
  setup: A4,
  onSetupChange: vi.fn(),
  onReset: vi.fn(),
  unmatched: { breaks: [], images: [], columns: [], fits: [], hidden: [] },
  headings: [],
  hidden: new Set<number>(),
  coveredBy: new Map<number, number>(),
  onToggleHeading: vi.fn(),
  nothingToPrint: false,
  fits: [],
  onRemoveUnmatched: vi.fn(),
  warnings: [],
  staleRevision: false,
  grantWarning: false,
  canSave: true,
  saving: false,
  onSave: vi.fn(),
  onPrint: vi.fn(),
  onClose: vi.fn(),
  ...over,
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SettingsPanel', () => {
  test('SettingsPanel: switching to 横 calls onSetupChange with orientation landscape', () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '横' }));
    expect(p.onSetupChange).toHaveBeenCalledWith({ ...A4, orientation: 'landscape' });
  });

  test('SettingsPanel: margin input 60 is rejected and onSetupChange is not called', () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    const top = screen.getByLabelText('上');
    fireEvent.change(top, { target: { value: '60' } });
    expect(p.onSetupChange).not.toHaveBeenCalled();
    expect(top.getAttribute('aria-invalid')).toBe('true');
  });

  test('a margin within 0..50 is committed', () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    fireEvent.change(screen.getByLabelText('左'), { target: { value: '0' } });
    expect(p.onSetupChange).toHaveBeenCalledWith({ ...A4, margin: { ...A4.margin, left: 0 } });
  });

  test('an empty margin input is not committed', () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    fireEvent.change(screen.getByLabelText('下'), { target: { value: '' } });
    expect(p.onSetupChange).not.toHaveBeenCalled();
  });

  test('choosing A3 updates the size and its millimetre dimensions', () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    fireEvent.change(screen.getByLabelText('用紙'), { target: { value: 'A3' } });
    expect(p.onSetupChange).toHaveBeenCalledWith({ ...A4, size: 'A3', widthMm: 297, heightMm: 420 });
  });

  test('SettingsPanel: save button disabled when canSave is false', () => {
    render(<SettingsPanel {...props({ canSave: false })} />);
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('save button is disabled while saving', () => {
    render(<SettingsPanel {...props({ saving: true })} />);
    expect((screen.getByRole('button', { name: '保存中…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('buttons call their handlers', () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '自動に戻す' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    fireEvent.click(screen.getByRole('button', { name: 'PDF に印刷' }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(p.onReset).toHaveBeenCalledTimes(1);
    expect(p.onSave).toHaveBeenCalledTimes(1);
    expect(p.onPrint).toHaveBeenCalledTimes(1);
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  test('lists unmatched adjustments and removes one by kind and index', () => {
    const brk: BreakEntry = { anchor: { tag: 'h2', textHash: '0000abcd', occurrence: 0 } };
    const img: ImageEntry = { anchor: { kind: 'img', key: '/attachment/x', occurrence: 1 }, widthPercent: 40 };
    const col: ColumnEntry = { anchor: { tag: 'div', textHash: '0000beef', occurrence: 0 }, leftPercent: 30 };
    const p = props({ unmatched: { breaks: [brk], images: [img], columns: [col], fits: [], hidden: [] } });
    render(<SettingsPanel {...p} />);
    expect(screen.getByText('適用できなかった調整: 3 件')).toBeTruthy();
    expect(screen.getByText('2段組（30:70）')).toBeTruthy();
    const removes = screen.getAllByRole('button', { name: '削除' });
    fireEvent.click(removes[1]);
    expect(p.onRemoveUnmatched).toHaveBeenCalledWith('image', 0);
    fireEvent.click(removes[2]);
    expect(p.onRemoveUnmatched).toHaveBeenCalledWith('column', 0);
  });

  test('labels unmatched fit entries and removes one with the fit kind', () => {
    const anchor = { tag: 'table', textHash: '0000beef', occurrence: 0 };
    const fits: FitEntry[] = [{ anchor, mode: 'shrink' }, { anchor, mode: 'scale', scalePercent: 70 }];
    const p = props({ unmatched: { breaks: [], images: [], columns: [], fits, hidden: [] } });
    render(<SettingsPanel {...p} />);
    expect(screen.getByText('幅合わせ: 縮小のみ')).toBeTruthy();
    expect(screen.getByText('幅合わせ: 倍率 70%')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '削除' })[1]);
    expect(p.onRemoveUnmatched).toHaveBeenCalledWith('fit', 1);
  });

  test('lists a warning per fit result, numbering targets per kind from 1', () => {
    const fit = (over: Partial<FitResult>): FitResult => ({ index: 0, kind: 'table', mode: 'auto', scale: 1, warning: null, ...over });
    const fits = [
      fit({ index: 0, kind: 'table' }),
      fit({ index: 1, kind: 'code', mode: 'auto', scale: 0.45, warning: 'small' }),
      fit({ index: 2, kind: 'table', mode: 'scale', scale: 0.8, warning: 'overflow' }),
      fit({ index: 3, kind: 'code', mode: 'scale', scale: 0.6, warning: 'overflow' }),
      fit({ index: 4, kind: 'table', mode: 'shrink', scale: 0.5, warning: 'small' }),
    ];
    render(<SettingsPanel {...props({ fits })} />);
    expect(screen.getByText('幅合わせの警告: 4 件')).toBeTruthy();
    expect(screen.getByText('コード 1: 縮小 45%（文字が小さくなります）')).toBeTruthy();
    expect(screen.getByText('表 2: 倍率 80% では幅に収まりません（右端が切れます）')).toBeTruthy();
    expect(screen.getByText('コード 2: 倍率 60% では幅に収まりません（右端が切れます）')).toBeTruthy();
    expect(screen.getByText('表 3: 縮小 50%（文字が小さくなります）')).toBeTruthy();
  });

  test('targets inside hidden sections are not warned about, and the others keep their numbers', () => {
    const fit = (over: Partial<FitResult>): FitResult => ({ index: 0, kind: 'table', mode: 'auto', scale: 0.5, warning: 'small', ...over });
    render(<SettingsPanel {...props({ fits: [fit({}), fit({ index: 1, scale: 0.4 })], hiddenFits: new Set([0]) })} />);
    expect(screen.getByText('幅合わせの警告: 1 件')).toBeTruthy();
    expect(screen.getByText('表 2: 縮小 40%（文字が小さくなります）')).toBeTruthy();
    expect(screen.queryByText(/表 1:/)).toBeNull();
  });

  test('an overflow of a target whose scale the user did not fix names no scale', () => {
    const fit = (over: Partial<FitResult>): FitResult => ({ index: 0, kind: 'table', mode: 'auto', scale: 1, warning: 'overflow', ...over });
    render(<SettingsPanel {...props({ fits: [fit({}), fit({ index: 1, kind: 'code', mode: 'shrink', scale: 0.7 })] })} />);
    expect(screen.getByText('表 1: 幅に収まりません（右端が切れます）')).toBeTruthy();
    expect(screen.getByText('コード 1: 幅に収まりません（右端が切れます）')).toBeTruthy();
  });

  test('shows no fit warning block when no result has a warning', () => {
    render(<SettingsPanel {...props({ fits: [{ index: 0, kind: 'table', mode: 'auto', scale: 1, warning: null }] })} />);
    expect(screen.queryByText(/幅合わせの警告/)).toBeNull();
  });

  test('shows the stale-revision and grant notices and warnings', () => {
    render(<SettingsPanel {...props({ staleRevision: true, grantWarning: true, warnings: ['注意'] })} />);
    expect(screen.getByText('前回の調整後に本文が更新されています')).toBeTruthy();
    expect(screen.getByText('この設定ページの閲覧範囲が元ページより広くなっています')).toBeTruthy();
    expect(screen.getByText('注意')).toBeTruthy();
  });

  test('the panel root carries .pl-ui', () => {
    const { container } = render(<SettingsPanel {...props()} />);
    expect(container.firstElementChild?.classList.contains('pl-ui')).toBe(true);
  });

  test('an unmatched hide setting is listed as 非表示 with the label and can be removed', () => {
    const p = props({
      unmatched: {
        breaks: [],
        images: [],
        columns: [],
        fits: [],
        hidden: [{ anchor: { tag: 'H2', textHash: 'h', parents: [], occurrence: 0 }, label: '社内メモ' }],
      },
    });
    render(<SettingsPanel {...p} />);
    expect(screen.getByText('適用できなかった調整: 1 件')).toBeTruthy();
    expect(screen.getByText('非表示: 社内メモ')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(p.onRemoveUnmatched).toHaveBeenCalledWith('hidden', 0);
  });

  test('the heading list sits between the paper settings and the unmatched list', () => {
    const headings = [{ blockIndex: 0, level: 2, label: 'A', anchor: { tag: 'H2', textHash: 'a', parents: [], occurrence: 0 } }];
    const p = props({ headings });
    render(<SettingsPanel {...p} />);
    const list = screen.getByText('見出し');
    const unmatched = screen.getByText('適用できなかった調整: 0 件');
    expect(screen.getByLabelText('用紙').compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.compareDocumentPosition(unmatched) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '印刷しない: A' }));
    expect(p.onToggleHeading).toHaveBeenCalledWith(0, true);
  });

  test('nothing to print disables 印刷 and says so', () => {
    render(<SettingsPanel {...props({ nothingToPrint: true })} />);
    expect((screen.getByRole('button', { name: 'PDF に印刷' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('印刷する内容がありません')).toBeTruthy();
  });

  test('printing is enabled when there is content', () => {
    render(<SettingsPanel {...props()} />);
    expect((screen.getByRole('button', { name: 'PDF に印刷' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('印刷する内容がありません')).toBeNull();
  });
});
