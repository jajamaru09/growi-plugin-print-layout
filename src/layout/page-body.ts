import type { LayoutSettings } from './types';

export const LAYOUT_PAGE_NOTICE =
  'このページは印刷レイアウトプラグインの設定です。手で編集しないでください。';

const FENCE = '```';
const JSON_FENCE_PATTERN = new RegExp(`${FENCE}json[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n${FENCE}`);

export function extractLayoutJson(markdown: string): unknown | null {
  const match = JSON_FENCE_PATTERN.exec(markdown);
  if (match == null) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function serializeLayoutPage(layout: LayoutSettings): string {
  return `${LAYOUT_PAGE_NOTICE}\n\n${FENCE}json\n${JSON.stringify(layout, null, 2)}\n${FENCE}\n`;
}
