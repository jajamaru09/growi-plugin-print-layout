import { describe, expect, test } from 'vitest';
import { isPrintShortcut, printConfirmMessage } from './print-guard';

describe('printConfirmMessage', () => {
  const none = { unmatchedLabels: [], droppedHidden: 0, layoutUnreadable: false };

  test('lists every label under a count line', () => {
    expect(printConfirmMessage({ ...none, unmatchedLabels: ['社内メモ', '価格'] })).toBe(
      '隠す設定のうち 2 件が本文に見つかりません。隠したつもりの内容が印刷される可能性があります。\n・社内メモ\n・価格\n\nOK を押すと印刷します。',
    );
  });

  test('returns null when every hide setting was read and matched', () => {
    expect(printConfirmMessage(none)).toBeNull();
  });

  test('lists at most 10 labels, then the remaining count', () => {
    const labels = Array.from({ length: 12 }, (_, i) => `見出し${i + 1}`);
    const message = printConfirmMessage({ ...none, unmatchedLabels: labels }) ?? '';
    expect(message).toContain('隠す設定のうち 12 件が本文に見つかりません。');
    expect(message).toContain('・見出し10\nほか 2 件\n');
    expect(message).not.toContain('見出し11');
  });

  test('hide entries that could not be read ask on their own', () => {
    expect(printConfirmMessage({ ...none, droppedHidden: 1 })).toBe(
      '保存された隠す設定の一部を読み取れませんでした。隠したつもりの内容が印刷される可能性があります。\n\nOK を押すと印刷します。',
    );
  });

  test('unread hide entries add a line after the unmatched labels', () => {
    expect(printConfirmMessage({ ...none, unmatchedLabels: ['社内メモ'], droppedHidden: 2 })).toBe(
      '隠す設定のうち 1 件が本文に見つかりません。隠したつもりの内容が印刷される可能性があります。\n・社内メモ\n保存された隠す設定の一部を読み取れませんでした。\n\nOK を押すと印刷します。',
    );
  });

  test('an unreadable layout page asks with its own text', () => {
    expect(printConfirmMessage({ ...none, layoutUnreadable: true })).toBe(
      '保存された設定を読み取れませんでした。隠す設定が反映されていない可能性があります。\n\nOK を押すと印刷します。',
    );
  });
});

describe('isPrintShortcut', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  });

  test('Ctrl+P, Cmd+P and Ctrl+Shift+P are print shortcuts', () => {
    expect(isPrintShortcut(key('p', { ctrlKey: true }))).toBe(true);
    expect(isPrintShortcut(key('p', { metaKey: true }))).toBe(true);
    expect(isPrintShortcut(key('P', { ctrlKey: true }))).toBe(true);
  });

  test('P alone, Ctrl+Alt+P and other Ctrl keys are not', () => {
    expect(isPrintShortcut(key('p'))).toBe(false);
    expect(isPrintShortcut(key('p', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPrintShortcut(key('s', { ctrlKey: true }))).toBe(false);
  });
});
