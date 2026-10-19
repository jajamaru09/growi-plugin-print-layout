import { type ChangeEvent, useEffect, useState } from 'react';
import { MARGIN_RANGE_MM, PAPER_SIZES_MM } from '../constants';
import type { BreakEntry, ColumnEntry, FitEntry, HeadingInfo, HiddenEntry, ImageEntry, Margins, PageSetup, PaperSize } from '../layout';
import type { FitResult } from '../pagination';
import type { UnmatchedKind } from './edit-state';
import { HeadingList } from './HeadingList';

export interface SettingsPanelProps {
  setup: PageSetup;
  onSetupChange(s: PageSetup): void;
  onReset(): void;
  unmatched: { breaks: BreakEntry[]; images: ImageEntry[]; columns: ColumnEntry[]; fits: FitEntry[]; hidden: HiddenEntry[] };
  headings: readonly HeadingInfo[];
  hidden: ReadonlySet<number>;
  coveredBy: ReadonlyMap<number, number>;
  onToggleHeading(headingBlockIndex: number, hide: boolean): void;
  /** True when every block is hidden; printing is then pointless. */
  nothingToPrint: boolean;
  /** Results of the current layout's fit pass; only their warnings are shown. */
  fits: readonly FitResult[];
  /** Fit targets inside hidden sections: they do not print, so they are not warned about. */
  hiddenFits?: ReadonlySet<number>;
  onRemoveUnmatched(kind: UnmatchedKind, index: number): void;
  warnings: string[];
  staleRevision: boolean;
  grantWarning: boolean;
  canSave: boolean;
  saving: boolean;
  onSave(): void;
  onPrint(): void;
  onClose(): void;
}

const PAPER_SIZES: readonly PaperSize[] = ['A4', 'A3', 'B5'];
const MARGIN_SIDES: readonly { side: keyof Margins; label: string }[] = [
  { side: 'top', label: '上' },
  { side: 'bottom', label: '下' },
  { side: 'left', label: '左' },
  { side: 'right', label: '右' },
];
const KEY_DISPLAY_LIMIT = 40;

/** Returns the margin in mm, or null when the text is not a number within the allowed range. */
export function parseMarginInput(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= MARGIN_RANGE_MM.min && value <= MARGIN_RANGE_MM.max ? value : null;
}

const MarginInput = ({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit(mm: number): void;
}) => {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const invalid = parseMarginInput(draft) == null;
  const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setDraft(e.target.value);
    const mm = parseMarginInput(e.target.value);
    if (mm != null && mm !== value) onCommit(mm);
  };
  return (
    <label className="pl-margin">
      <span>{label}</span>
      <input
        type="number"
        min={MARGIN_RANGE_MM.min}
        max={MARGIN_RANGE_MM.max}
        step={1}
        value={draft}
        aria-invalid={invalid}
        onChange={onChange}
        onBlur={() => setDraft(String(value))}
      />
    </label>
  );
};

const truncate = (text: string): string =>
  text.length > KEY_DISPLAY_LIMIT ? `${text.slice(0, KEY_DISPLAY_LIMIT)}…` : text;

const UnmatchedList = ({
  unmatched,
  onRemove,
}: {
  unmatched: SettingsPanelProps['unmatched'];
  onRemove: SettingsPanelProps['onRemoveUnmatched'];
}) => {
  const items = [
    ...unmatched.breaks.map((entry, index) => ({
      kind: 'break' as const,
      index,
      text: `改ページ（${entry.anchor.tag}）`,
    })),
    ...unmatched.images.map((entry, index) => ({
      kind: 'image' as const,
      index,
      text: `画像 ${truncate(entry.anchor.key)}（幅 ${entry.widthPercent}%）`,
    })),
    ...unmatched.columns.map((entry, index) => ({
      kind: 'column' as const,
      index,
      text: `2段組（${entry.leftPercent}:${100 - entry.leftPercent}）`,
    })),
    ...unmatched.fits.map((entry, index) => ({
      kind: 'fit' as const,
      index,
      text: entry.mode === 'shrink' ? '幅合わせ: 縮小のみ' : `幅合わせ: 倍率 ${entry.scalePercent}%`,
    })),
    ...unmatched.hidden.map((entry, index) => ({
      kind: 'hidden' as const,
      index,
      text: `非表示: ${entry.label}`,
    })),
  ];
  return (
    <section className="pl-section">
      <p className="pl-unmatched-count">{`適用できなかった調整: ${items.length} 件`}</p>
      {items.length > 0 && (
        <ul className="pl-unmatched">
          {items.map((item) => (
            <li key={`${item.kind}-${item.index}`}>
              <span>{item.text}</span>
              <button type="button" onClick={() => onRemove(item.kind, item.index)}>
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const KIND_LABEL: Record<FitResult['kind'], string> = { table: '表', code: 'コード' };

/** One line per warned fit result; targets are numbered from 1 within their kind. */
export function fitWarningLines(fits: readonly FitResult[], hiddenFits: ReadonlySet<number> = new Set()): string[] {
  const seen: Record<FitResult['kind'], number> = { table: 0, code: 0 };
  return fits.flatMap((fit) => {
    seen[fit.kind] += 1;
    if (fit.warning == null || hiddenFits.has(fit.index)) return [];
    const label = `${KIND_LABEL[fit.kind]} ${seen[fit.kind]}`;
    const percent = Math.round(fit.scale * 100);
    if (fit.warning === 'small') return [`${label}: 縮小 ${percent}%（文字が小さくなります）`];
    // Only a scale the user fixed is worth naming; otherwise the fit pass chose it.
    if (fit.mode === 'scale') return [`${label}: 倍率 ${percent}% では幅に収まりません（右端が切れます）`];
    return [`${label}: 幅に収まりません（右端が切れます）`];
  });
}

export const SettingsPanel = (props: SettingsPanelProps) => {
  const { setup, onSetupChange } = props;
  const setSize = (size: PaperSize): void => onSetupChange({ ...setup, size, ...PAPER_SIZES_MM[size] });
  const setMargin = (side: keyof Margins, mm: number): void =>
    onSetupChange({ ...setup, margin: { ...setup.margin, [side]: mm } });

  const fitWarnings = fitWarningLines(props.fits, props.hiddenFits);

  return (
    <aside className="pl-ui pl-panel">
      <section className="pl-section">
        <label className="pl-row">
          <span>用紙</span>
          <select value={setup.size} onChange={(e) => setSize(e.target.value as PaperSize)}>
            {PAPER_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="pl-row">
          <span>向き</span>
          <div className="pl-toggle">
            <button
              type="button"
              aria-pressed={setup.orientation === 'portrait'}
              onClick={() => onSetupChange({ ...setup, orientation: 'portrait' })}
            >
              縦
            </button>
            <button
              type="button"
              aria-pressed={setup.orientation === 'landscape'}
              onClick={() => onSetupChange({ ...setup, orientation: 'landscape' })}
            >
              横
            </button>
          </div>
        </div>
        <fieldset className="pl-margins">
          <legend>余白 (mm)</legend>
          {MARGIN_SIDES.map(({ side, label }) => (
            <MarginInput
              key={side}
              label={label}
              value={setup.margin[side]}
              onCommit={(mm) => setMargin(side, mm)}
            />
          ))}
        </fieldset>
        <button type="button" onClick={props.onReset}>
          自動に戻す
        </button>
      </section>

      <HeadingList
        headings={props.headings}
        hidden={props.hidden}
        coveredBy={props.coveredBy}
        onToggle={props.onToggleHeading}
      />

      <UnmatchedList unmatched={props.unmatched} onRemove={props.onRemoveUnmatched} />

      {fitWarnings.length > 0 && (
        <section className="pl-section pl-notices">
          <p className="pl-notice">{`幅合わせの警告: ${fitWarnings.length} 件`}</p>
          {fitWarnings.map((line) => (
            <p key={line} className="pl-notice">
              {line}
            </p>
          ))}
        </section>
      )}

      {(props.staleRevision || props.grantWarning || props.warnings.length > 0) && (
        <section className="pl-section pl-notices">
          {props.staleRevision && <p className="pl-notice">前回の調整後に本文が更新されています</p>}
          {props.grantWarning && <p className="pl-notice">この設定ページの閲覧範囲が元ページより広くなっています</p>}
          {props.warnings.map((w) => (
            <p key={w} className="pl-notice">
              {w}
            </p>
          ))}
        </section>
      )}

      <section className="pl-section pl-actions">
        <button type="button" className="pl-primary" disabled={!props.canSave || props.saving} onClick={props.onSave}>
          {props.saving ? '保存中…' : '保存'}
        </button>
        <button type="button" disabled={props.nothingToPrint} onClick={props.onPrint}>
          PDF に印刷
        </button>
        {props.nothingToPrint && <p className="pl-notice">印刷する内容がありません</p>}
        <button type="button" onClick={props.onClose}>
          閉じる
        </button>
      </section>
    </aside>
  );
};
