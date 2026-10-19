import { afterEach, expect, test } from 'vitest';
import { PRINT_STYLE_ID } from '../constants';
import type { PageSetup } from '../layout';
import { applyPrintStyle, removePrintStyle } from './print-style';

const A4_PORTRAIT: PageSetup = {
  size: 'A4',
  widthMm: 210,
  heightMm: 297,
  orientation: 'portrait',
  margin: { top: 15, bottom: 15, left: 20, right: 20 },
};

afterEach(() => {
  document.head.innerHTML = '';
});

const styles = (): HTMLStyleElement[] => Array.from(document.querySelectorAll<HTMLStyleElement>(`#${PRINT_STYLE_ID}`));

test('applyPrintStyle twice leaves exactly one style element containing "size: 297mm 210mm" for landscape A4', () => {
  applyPrintStyle(A4_PORTRAIT);
  applyPrintStyle({ ...A4_PORTRAIT, orientation: 'landscape' });

  const found = styles();
  expect(found).toHaveLength(1);
  expect(found[0].textContent).toContain('size: 297mm 210mm');
  expect(found[0].textContent).not.toContain('size: 210mm 297mm');
});

test('the print style hides everything but the plugin root and the plugin UI, and keeps colours', () => {
  applyPrintStyle(A4_PORTRAIT);

  const css = styles()[0].textContent ?? '';
  expect(css).toContain('@page { size: 210mm 297mm; margin: 0 }');
  expect(css).toContain('body > *:not(#growi-plugin-print-layout-root) { display: none !important }');
  expect(css).toContain('.pl-ui { display: none !important }');
  expect(css).toContain('break-after: page');
  expect(css).toContain('print-color-adjust: exact');
});

test('the page break after the final frame is released by its class, not by sibling order', () => {
  applyPrintStyle(A4_PORTRAIT);

  const css = styles()[0].textContent ?? '';
  // Overlay layers follow the frames in .pl-pages, so :last-child never matches the final frame.
  expect(css).toContain('.pl-page.pl-page-last { break-after: auto }');
  expect(css).not.toContain(':last-child');
});

test('removePrintStyle removes the style element and is safe to repeat', () => {
  applyPrintStyle(A4_PORTRAIT);
  removePrintStyle();
  removePrintStyle();

  expect(styles()).toHaveLength(0);
});

test('a non-finite page size is rejected instead of being written into the stylesheet', () => {
  expect(() => applyPrintStyle({ ...A4_PORTRAIT, widthMm: Number.NaN })).toThrow();
  expect(styles()).toHaveLength(0);
});

/** Style rules for `selector` inside the applied sheet's @media blocks, by media text. */
const mediaRulesFor = (selector: string): Record<string, CSSStyleDeclaration[]> => {
  const sheet = (document.getElementById(PRINT_STYLE_ID) as HTMLStyleElement).sheet as CSSStyleSheet;
  const byMedia: Record<string, CSSStyleDeclaration[]> = {};
  for (const rule of Array.from(sheet.cssRules)) {
    if (!(rule instanceof CSSMediaRule)) continue;
    const styles = Array.from(rule.cssRules)
      .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText === selector)
      .map((r) => r.style);
    byMedia[rule.media.mediaText] = [...(byMedia[rule.media.mediaText] ?? []), ...styles];
  }
  return byMedia;
};

test('a scaled-down block is outlined on screen only, without taking layout space', () => {
  applyPrintStyle(A4_PORTRAIT);
  const rules = mediaRulesFor('.pl-scaled');
  expect(rules.screen).toHaveLength(1);
  expect(rules.screen[0].getPropertyValue('outline')).toMatch(/dashed/);
  expect(rules.screen[0].getPropertyValue('border')).toBe('');
  expect(rules.print ?? []).toHaveLength(0);
});
