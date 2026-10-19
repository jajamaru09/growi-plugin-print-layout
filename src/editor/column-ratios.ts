import type { ColumnTarget } from '../capture';

/** `flex` for a column taking `percent` of the row; the basis 0 makes the shares exact. */
export const columnFlex = (percent: number): string => `${percent} 1 0`;

const columnChildren = (column: ColumnTarget): HTMLElement[] =>
  Array.from(column.element.children).filter((c): c is HTMLElement => c instanceof HTMLElement);

/**
 * Sets the captured two-column layouts to their adjusted ratios (left column in %), restoring the
 * captured inline flex for columns without one. Measuring and rendering both clone these elements.
 * Returns a function that applies a new set of ratios to the same columns.
 */
export function createColumnRatioApplier(
  columns: readonly ColumnTarget[],
): (ratios: Readonly<Record<number, number>>) => void {
  const originals = columns.map((column) => columnChildren(column).map((child) => child.style.flex));

  return (ratios) => {
    columns.forEach((column, index) => {
      const percent = ratios[index];
      columnChildren(column).forEach((child, i) => {
        if (percent === undefined) {
          child.style.flex = originals[index][i] ?? '';
        } else {
          child.style.flex = columnFlex(i === 0 ? percent : 100 - percent);
        }
      });
    });
  };
}
