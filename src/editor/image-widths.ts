import type { ImageTarget } from '../layout';

interface OriginalSize {
  width: string;
  maxWidth: string;
  height: string;
  svgWidth: string | null;
}

/**
 * Sets the captured images to their adjusted widths (in % of the content box width),
 * restoring the captured inline sizes for images without one. Returns a function that
 * applies a new set of widths to the same images.
 *
 * The width is set in px from `contentWidthPx`: a CSS % would resolve against the
 * image's containing block (a column, list item or table cell), not the content box
 * the resize handle measures against.
 */
export function createImageWidthApplier(
  images: readonly ImageTarget[],
): (widths: Readonly<Record<number, number>>, contentWidthPx: number) => void {
  const originals: OriginalSize[] = images.map(({ element }) => ({
    width: element.style.width,
    maxWidth: element.style.maxWidth,
    height: element.style.height,
    svgWidth: element.querySelector('svg')?.style.width ?? null,
  }));

  return (widths, contentWidthPx) => {
    images.forEach(({ element, kind }, index) => {
      const original = originals[index];
      const percent = widths[index];
      // The drawio svg keeps its on-page px width; while adjusted it follows its wrapper instead.
      const svg = kind === 'drawio' ? element.querySelector('svg') : null;
      if (percent === undefined) {
        element.style.width = original.width;
        element.style.maxWidth = original.maxWidth;
        element.style.height = original.height;
        if (svg != null && original.svgWidth != null) svg.style.width = original.svgWidth;
        return;
      }
      element.style.width = `${(percent * contentWidthPx) / 100}px`;
      element.style.maxWidth = '100%';
      element.style.height = 'auto';
      if (svg != null) svg.style.width = '100%';
    });
  };
}
