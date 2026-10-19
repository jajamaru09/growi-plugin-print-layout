import { expect, test } from 'vitest';
import type { ImageTarget } from '../layout';
import { createImageWidthApplier } from './image-widths';

const CONTENT_WIDTH_PX = 600;

const targets = (): ImageTarget[] => {
  const img = document.createElement('img');
  img.style.width = '120px';
  const drawio = document.createElement('div');
  drawio.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  (drawio.querySelector('svg') as SVGSVGElement).style.width = '300px';
  return [
    { element: img, kind: 'img', key: '/a.png' },
    { element: drawio, kind: 'drawio', key: 'abcd1234' },
  ];
};

test('adjusted images get their % of the content box width in px, capped at their container, and auto height', () => {
  const images = targets();
  createImageWidthApplier(images)({ 0: 40 }, CONTENT_WIDTH_PX);
  expect(images[0].element.style.width).toBe('240px');
  expect(images[0].element.style.maxWidth).toBe('100%');
  expect(images[0].element.style.height).toBe('auto');
});

// A CSS % would resolve against the column (half the content width), not the content box the drag measured.
test('an image inside a 50% column is sized against the content box, not the column', () => {
  const columns = document.createElement('div');
  columns.style.display = 'flex';
  columns.innerHTML = '<div style="flex: 50 1 0"><img src="/a.png"></div><div style="flex: 50 1 0"></div>';
  const img = columns.querySelector('img') as HTMLElement;
  createImageWidthApplier([{ element: img, kind: 'img', key: '/a.png' }])({ 0: 40 }, CONTENT_WIDTH_PX);
  expect(img.style.width).toBe('240px');
});

test('an adjusted drawio wrapper takes the px width and its svg follows the wrapper', () => {
  const images = targets();
  createImageWidthApplier(images)({ 1: 60 }, CONTENT_WIDTH_PX);
  expect(images[1].element.style.width).toBe('360px');
  expect(images[1].element.querySelector('svg')?.style.width).toBe('100%');
});

test('the width follows the content box of each run', () => {
  const images = targets();
  const apply = createImageWidthApplier(images);
  apply({ 0: 50 }, CONTENT_WIDTH_PX);
  apply({ 0: 50 }, 800);
  expect(images[0].element.style.width).toBe('400px');
});

test('removing an adjustment restores the captured sizes', () => {
  const images = targets();
  images[0].element.style.maxWidth = '50%';
  const apply = createImageWidthApplier(images);
  apply({ 0: 40, 1: 60 }, CONTENT_WIDTH_PX);
  apply({}, CONTENT_WIDTH_PX);
  expect(images[0].element.style.width).toBe('120px');
  expect(images[0].element.style.maxWidth).toBe('50%');
  expect(images[0].element.style.height).toBe('');
  expect(images[1].element.style.width).toBe('');
  expect(images[1].element.style.maxWidth).toBe('');
  expect(images[1].element.querySelector('svg')?.style.width).toBe('300px');
});
