const SVG_NS = 'http://www.w3.org/2000/svg';

const EYE_OUTLINE = 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z';
const PUPIL = 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z';
const SLASH = 'M3 3l18 18';

function createIcon(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

export const OPEN_EYE_PATHS: readonly string[] = [EYE_OUTLINE, PUPIL];
export const CLOSED_EYE_PATHS: readonly string[] = [EYE_OUTLINE, PUPIL, SLASH];

export const createOpenEyeIcon = (): SVGSVGElement => createIcon(OPEN_EYE_PATHS);

export const createClosedEyeIcon = (): SVGSVGElement => createIcon(CLOSED_EYE_PATHS);
