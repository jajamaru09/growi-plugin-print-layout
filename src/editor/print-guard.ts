const MAX_LISTED_LABELS = 10;

export interface PrintConfirmInput {
  /** Labels of saved hide settings that match no heading. */
  unmatchedLabels: readonly string[];
  /** Saved hide entries that could not be read. */
  droppedHidden: number;
  /** The layout page exists but could not be read at all. */
  layoutUnreadable: boolean;
}

const labelLines = (labels: readonly string[]): string[] => {
  const listed = labels.slice(0, MAX_LISTED_LABELS).map((label) => `・${label}`);
  const rest = labels.length - MAX_LISTED_LABELS;
  return rest > 0 ? [...listed, `ほか ${rest} 件`] : listed;
};

/** Confirm text before printing while a saved hide might not be applied; null when there is nothing to warn about. */
export function printConfirmMessage({ unmatchedLabels, droppedHidden, layoutUnreadable }: PrintConfirmInput): string | null {
  const parts: string[] = [];
  if (unmatchedLabels.length > 0) {
    parts.push(
      `隠す設定のうち ${unmatchedLabels.length} 件が本文に見つかりません。隠したつもりの内容が印刷される可能性があります。`,
      ...labelLines(unmatchedLabels),
    );
  }
  if (droppedHidden > 0) {
    parts.push(
      parts.length > 0
        ? '保存された隠す設定の一部を読み取れませんでした。'
        : '保存された隠す設定の一部を読み取れませんでした。隠したつもりの内容が印刷される可能性があります。',
    );
  }
  if (layoutUnreadable) {
    parts.push('保存された設定を読み取れませんでした。隠す設定が反映されていない可能性があります。');
  }
  return parts.length === 0 ? null : `${parts.join('\n')}\n\nOK を押すと印刷します。`;
}

/** Ctrl+P / Cmd+P (with or without Shift), the keyboard routes to the browser's print. */
export function isPrintShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && typeof e.key === 'string' && e.key.toLowerCase() === 'p';
}
