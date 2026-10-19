import { afterEach, describe, expect, test } from 'vitest';
import css from './editor.css?raw';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

const styleRules = (): CSSStyleRule[] => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return Array.from((style.sheet as CSSStyleSheet).cssRules).filter((r): r is CSSStyleRule => r instanceof CSSStyleRule);
};

/** An element at `path` (selectors of nested elements) under a fresh editor root. */
const elementAt = (...path: string[]): Element => {
  let parent: Element = document.body;
  for (const html of path) {
    parent.insertAdjacentHTML('beforeend', html);
    parent = parent.lastElementChild as Element;
  }
  return parent;
};

const CONTENT = ['<div class="pl-editor">', '<main class="pl-preview">', '<div class="pl-pages">', '<div class="pl-page">', '<div class="pl-content wiki">'];

// The measuring host is not inside .pl-editor, so a rule reaching page content would make the preview differ from the measurement.
test.each([
  ['a task-list checkbox', '<input type="checkbox">'],
  ['a button', '<button type="button">b</button>'],
  ['a select', '<select></select>'],
  ['a table', '<table>'],
  ['a table cell', '<table>', '<tbody>', '<tr>', '<td>'],
  ['a code block', '<pre>'],
  ['code in a code block', '<pre>', '<code>'],
])('%s in the rendered page content gets no editor style', (_label, ...html) => {
  const rules = styleRules();
  const el = elementAt(...CONTENT, ...html);
  expect(rules.filter((r) => el.matches(r.selectorText)).map((r) => r.selectorText)).toEqual([]);
});

test('controls in the editor UI keep their styles', () => {
  const rules = styleRules();
  const button = elementAt('<div class="pl-editor">', '<div class="pl-ui pl-sidebar">', '<button type="button">保存</button>');
  const input = elementAt('<div class="pl-editor">', '<div class="pl-ui pl-sidebar">', '<input type="number">');
  const overlayButton = elementAt(...CONTENT.slice(0, 3), '<div class="pl-ui pl-image-layer">', '<button class="pl-image-reset">r</button>');
  for (const el of [button, input, overlayButton]) {
    expect(rules.some((r) => el.matches(r.selectorText) && r.style.getPropertyValue('padding') !== '')).toBe(true);
  }
});

const matching = (rules: CSSStyleRule[], el: Element): CSSStyleRule[] => rules.filter((r) => el.matches(r.selectorText));

// The measuring host sits directly in body, so the fit rules must not depend on any editor ancestor.
describe.each([
  ['in the rendered pages', CONTENT],
  ['in the measuring host', ['<div class="wiki">']],
])('fit rules %s', (_label, root) => {
  test('a fitted table wraps its cells and never scrolls, only through the fit classes', () => {
    const rules = styleRules();
    const table = elementAt(...root, '<table class="pl-fit pl-fit-wrap">');
    const cell = elementAt(...root, '<table class="pl-fit pl-fit-wrap">', '<tbody>', '<tr>', '<td>');
    expect(matching(rules, table).some((r) => r.style.getPropertyValue('overflow') === 'visible')).toBe(true);
    expect(matching(rules, table).some((r) => r.style.getPropertyValue('max-width') === '100%')).toBe(true);
    expect(matching(rules, cell).some((r) => r.style.getPropertyValue('white-space') === 'normal')).toBe(true);
    for (const el of [table, cell]) {
      expect(matching(rules, el).every((r) => r.selectorText.includes('.pl-fit'))).toBe(true);
    }
  });

  const values = (rules: CSSStyleRule[], el: Element, prop: string): string[] =>
    matching(rules, el)
      .map((r) => r.style.getPropertyValue(prop))
      .filter((v) => v !== '');

  // GROWI's .wiki sets an inherited `word-break: break-word`, which breaks inside words like `anywhere`.
  test('a wrapped table breaks its cells only between words; links and inline code in them may break anywhere', () => {
    const rules = styleRules();
    const cell = [...root, '<table class="pl-fit pl-fit-wrap">', '<tbody>', '<tr>', '<td>'];
    const td = elementAt(...cell);
    const th = elementAt(...root, '<table class="pl-fit pl-fit-wrap">', '<thead>', '<tr>', '<th>');
    for (const el of [td, th]) {
      expect(values(rules, el, 'overflow-wrap')).toEqual(['normal']);
      expect(values(rules, el, 'word-break')).toEqual(['normal']);
    }
    for (const el of [elementAt(...cell, '<a href="/x">'), elementAt(...cell, '<code>')]) {
      expect(values(rules, el, 'overflow-wrap')).toEqual(['anywhere']);
    }
  });

  // Spec 5.4.2 縮小のみ: no soft wrap at all, so GROWI's inherited break-word has nothing to act on either.
  test('a shrink-only table keeps every cell on its lines, and nothing in it may break anywhere', () => {
    const rules = styleRules();
    const cell = [...root, '<table class="pl-fit">', '<tbody>', '<tr>', '<td>'];
    const td = elementAt(...cell);
    const th = elementAt(...root, '<table class="pl-fit">', '<thead>', '<tr>', '<th>');
    for (const el of [td, th]) {
      const declaring = matching(rules, el).filter((r) => r.style.getPropertyValue('white-space') !== '');
      expect(declaring.map((r) => r.style.getPropertyValue('white-space'))).toEqual(['nowrap']);
      expect(declaring[0].style.getPropertyPriority('white-space')).toBe('important');
    }
    expect(values(rules, elementAt(...cell, '<a href="/x">'), 'overflow-wrap')).toEqual([]);
    expect(values(rules, elementAt(...cell, '<code>'), 'overflow-wrap')).toEqual([]);
  });

  // A token wider than the page makes the block overflow, and the fit pass then shrinks it.
  test('a wrapped code block never breaks inside a word, links and highlighter lines included', () => {
    const rules = styleRules();
    const pre = [...root, '<pre class="pl-fit pl-fit-wrap">', '<code>'];
    const els = [
      elementAt(...pre.slice(0, -1)),
      elementAt(...pre),
      elementAt(...pre, '<span class="token">'),
      elementAt(...pre, '<a href="/x">'),
      elementAt(...pre, '<table>', '<tbody>', '<tr>', '<td>'),
    ];
    for (const el of els) {
      expect(values(rules, el, 'overflow-wrap')).toEqual(['normal']);
      expect(values(rules, el, 'word-break')).toEqual(['normal']);
      // Important, so a highlighter's own word-break / overflow-wrap on its elements does not win.
      const priorities = matching(rules, el)
        .filter((r) => r.style.getPropertyValue('word-break') !== '')
        .map((r) => r.style.getPropertyPriority('word-break'));
      expect(priorities).toEqual(['important']);
    }
  });

  test('a wrapped code block wraps its lines; a shrink-only one keeps them', () => {
    const rules = styleRules();
    const wrapped = elementAt(...root, '<pre class="pl-fit pl-fit-wrap">', '<code>');
    const shrunk = elementAt(...root, '<pre class="pl-fit">', '<code>');
    expect(matching(rules, wrapped).some((r) => r.style.getPropertyValue('white-space') === 'pre-wrap')).toBe(true);
    expect(matching(rules, shrunk).filter((r) => r.style.getPropertyValue('white-space') !== '')).toEqual([]);
  });

  // growi-plugin-codeblock-style puts each line in a `td` with its own `white-space: pre`.
  test('a line element a highlighter puts inside the code wraps too; in a shrink-only block it does not', () => {
    const rules = styleRules();
    const line = elementAt(...root, '<pre class="pl-fit pl-fit-wrap">', '<code>', '<table>', '<tbody>', '<tr>', '<td>');
    const shrunkLine = elementAt(...root, '<pre class="pl-fit">', '<code>', '<table>', '<tbody>', '<tr>', '<td>');
    const wraps = (r: CSSStyleRule): boolean =>
      r.style.getPropertyValue('white-space') === 'pre-wrap' && r.style.getPropertyPriority('white-space') === 'important';
    expect(matching(rules, line).some(wraps)).toBe(true);
    expect(matching(rules, shrunkLine).filter((r) => r.style.getPropertyValue('white-space') !== '')).toEqual([]);
  });

  // A prompt such as `$ ` or a padded number holds a space a wrapping line could break at.
  test('in a table inside the code, the cells before the line itself (line numbers, prompts) stay on one line', () => {
    const rules = styleRules();
    const row = [...root, '<pre class="pl-fit pl-fit-wrap">', '<code>', '<table>', '<tbody>', '<tr>'];
    const gutter = elementAt(...row, '<td>');
    const line = gutter.parentElement?.appendChild(document.createElement('td')) as Element;
    const winner = (el: Element): string | undefined =>
      matching(rules, el)
        .filter((r) => r.style.getPropertyPriority('white-space') === 'important')
        .sort((a, b) => a.selectorText.length - b.selectorText.length)
        .pop()
        ?.style.getPropertyValue('white-space');
    expect(winner(gutter)).toBe('nowrap');
    expect(winner(line)).toBe('pre-wrap');
  });

  test('nothing inside a fitted code block scrolls on its own', () => {
    const rules = styleRules();
    const pre = elementAt(...root, '<pre class="pl-fit">');
    const box = elementAt(...root, '<pre class="pl-fit">', '<div>');
    const code = elementAt(...root, '<pre class="pl-fit">', '<div>', '<code>');
    for (const el of [pre, box, code]) {
      expect(matching(rules, el).some((r) => r.style.getPropertyValue('overflow') === 'visible')).toBe(true);
      expect(matching(rules, el).every((r) => r.selectorText.includes('.pl-fit'))).toBe(true);
    }
  });
});

// Rendered content may position its own parts above the page (codeblock-style's filename label has z-index 2).
test('the fit badge layer stacks above positioned page content', () => {
  const rules = styleRules();
  const layer = elementAt(...CONTENT.slice(0, 3), '<div class="pl-ui pl-fit-layer">');
  const zIndex = matching(rules, layer)
    .map((r) => r.style.getPropertyValue('z-index'))
    .find((z) => z !== '');
  expect(Number(zIndex)).toBeGreaterThanOrEqual(10);
});

test('a gray line before a block aligns its tags to the line from above; the end-of-document line centres them', () => {
  const rules = styleRules();
  const alignOf = (el: Element): string | undefined =>
    matching(rules, el)
      .map((r) => r.style.getPropertyValue('align-items'))
      .filter((v) => v !== '')
      .pop();
  const layer = [...CONTENT.slice(0, 3), '<div class="pl-ui pl-hide-layer">'];
  expect(alignOf(elementAt(...layer, '<div class="pl-ui pl-hidden-line pl-hidden-line-above">'))).toBe('flex-end');
  expect(alignOf(elementAt(...layer, '<div class="pl-ui pl-hidden-line">'))).toBe('center');
});
