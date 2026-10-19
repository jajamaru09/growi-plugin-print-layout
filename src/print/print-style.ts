import { MOUNT_ID, PRINT_STYLE_ID } from '../constants';
import type { PageSetup } from '../layout';
import { pageFrameSizeMm } from '../pagination';

const finiteMm = (mm: number): number => {
  if (!Number.isFinite(mm) || mm <= 0) throw new Error(`print style: invalid page size ${mm}mm`);
  return mm;
};

/**
 * The stylesheet is assembled only from validated numbers. Besides the brief's
 * rules it releases the fixed, scrolling mount root while printing: a fixed
 * element repeats on every printed page instead of flowing. On screen, a block
 * scaled down to fit its page is outlined; an outline takes no layout space,
 * and a negative offset keeps it visible on a page with zero margins.
 */
const printCss = (widthMm: number, heightMm: number): string => `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0 }
@media screen {
  .pl-page { margin: 16px auto; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3) }
  .pl-scaled { outline: 2px dashed #fd7e14; outline-offset: -2px }
}
@media print {
  html, body { height: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #fff !important }
  body > *:not(#${MOUNT_ID}) { display: none !important }
  #${MOUNT_ID}, #${MOUNT_ID} .pl-pages { position: static !important; overflow: visible !important; height: auto !important; padding: 0 !important; margin: 0 !important; background: none !important }
  .pl-ui { display: none !important }
  .pl-page { break-after: page; box-shadow: none; margin: 0 }
  .pl-page.pl-page-last { break-after: auto }
  * { print-color-adjust: exact; -webkit-print-color-adjust: exact }
}
`;

export function applyPrintStyle(setup: PageSetup): void {
  const { widthMm, heightMm } = pageFrameSizeMm(setup);
  const css = printCss(finiteMm(widthMm), finiteMm(heightMm));
  removePrintStyle();
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

export function removePrintStyle(): void {
  document.getElementById(PRINT_STYLE_ID)?.remove();
}
