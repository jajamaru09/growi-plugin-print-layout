import { afterEach, describe, expect, test } from 'vitest';
import type { CapturedContent } from '../capture';
import { stripInteractiveChrome } from '../capture/strip-chrome';
import type { PageSetup } from '../layout';
import type { Page } from './paginate';
import { contentBoxPx, pageFrameSizeMm, readScale, renderPages } from './render-pages';

const A4_PORTRAIT: PageSetup = {
  size: 'A4',
  widthMm: 210,
  heightMm: 297,
  orientation: 'portrait',
  margin: { top: 15, bottom: 15, left: 20, right: 20 },
};
const A4_LANDSCAPE: PageSetup = { ...A4_PORTRAIT, orientation: 'landscape' };

const rows = (n: number): string =>
  Array.from({ length: n }, (_, i) => `<tr><td>r${i}</td></tr>`).join('');

// Mirrors GROWI 8.0.4 markup (see task-6 report): table wrapper with an edit
// button, image inside a button, drawio marker, code inside pre > div > code.
// makeContent strips it the way captureWiki does.
const WIKI_HTML = `
  <div class="editable-with-handsontable"><button class="handsontable-modal-trigger"><span>edit_note</span></button><table class="table"><thead><tr><th>head</th></tr></thead><tbody>${rows(5)}</tbody></table></div>
  <pre><cite class="cbs-filename-label">a.py</cite><div><code class="language-python"><span class="k">def</span> f():
<span class="c"># one
# two
</span>x = <span class="s">"a
b"</span>
</code></div></pre>
  <p><button class="border-0 bg-transparent p-0"><img alt="" src="/attachment/one"></button></p>
  <div data-print-layout-drawio="abcd1234"><svg xmlns="http://www.w3.org/2000/svg"><text>d</text></svg></div>
  <h2>tall</h2>`;

const makeContent = (): CapturedContent => {
  const root = document.createElement('div');
  root.className = 'wiki custom-class';
  root.innerHTML = WIKI_HTML;
  stripInteractiveChrome(root);
  const blocks = Array.from(root.children) as HTMLElement[];
  const img = root.querySelector('img') as HTMLElement;
  const drawio = root.querySelector<HTMLElement>('[data-print-layout-drawio]') as HTMLElement;
  return {
    root,
    blocks,
    images: [
      { element: img, kind: 'img', key: '/attachment/one' },
      { element: drawio, kind: 'drawio', key: 'abcd1234' },
    ],
    columns: [],
    fits: [],
  };
};

const renderOne = (page: Page, setup: PageSetup = A4_PORTRAIT): { pageEl: HTMLElement; content: CapturedContent } => {
  const content = makeContent();
  const host = document.createElement('div');
  const [pageEl] = renderPages(host, content, [page], setup);
  return { pageEl, content };
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('container fragments', () => {
  test('a container fragment keeps only its leaves and drops nested wrappers left empty', () => {
    const root = document.createElement('div');
    root.className = 'wiki';
    root.innerHTML = '<div data-pl-split=""><p>a</p><div data-pl-split=""><p>b</p><p>c</p></div><p>d</p></div>';
    const content: CapturedContent = {
      root,
      blocks: [root.firstElementChild as HTMLElement],
      images: [],
      columns: [],
      fits: [],
    };
    const page: Page = { placements: [{ blockIndex: 0, unitRange: { start: 3, end: 4 } }] };
    const [pageEl] = renderPages(document.createElement('div'), content, [page], A4_PORTRAIT);
    expect(pageEl.querySelector('.pl-content')?.textContent).toBe('d');
    expect(pageEl.querySelectorAll('[data-pl-split]')).toHaveLength(1);
  });

  test('a cut between bands keeps a wrapped two-column row whole', () => {
    const root = document.createElement('div');
    root.className = 'wiki';
    // What measure records for a .f2_container: one band per line, two items each.
    root.innerHTML =
      '<div data-pl-split="">' +
      '<div data-pl-leaf="0">a1</div><div data-pl-leaf="0">a2</div>' +
      '<div data-pl-leaf="1">b1</div><div data-pl-leaf="1">b2</div>' +
      '<div data-pl-leaf="2">c1</div><div data-pl-leaf="2">c2</div>' +
      '</div>';
    const content: CapturedContent = {
      root,
      blocks: [root.firstElementChild as HTMLElement],
      images: [],
      columns: [],
      fits: [],
    };
    const page: Page = { placements: [{ blockIndex: 0, unitRange: { start: 1, end: 3 } }] };
    const [pageEl] = renderPages(document.createElement('div'), content, [page], A4_PORTRAIT);

    expect(pageEl.querySelector('.pl-content')?.textContent).toBe('b1b2c1c2');
    // The band that opens the fragment was measured with the gap above it, so it must not push the page.
    const kept = Array.from(pageEl.querySelectorAll<HTMLElement>('[data-pl-leaf]'));
    expect(kept.filter((el) => el.style.marginTop === '0px').map((el) => el.textContent)).toEqual(['b1', 'b2']);
  });
});

describe('page geometry', () => {
  test('landscape A4 frame is 297×210mm', () => {
    expect(pageFrameSizeMm(A4_LANDSCAPE)).toEqual({ widthMm: 297, heightMm: 210 });
    expect(pageFrameSizeMm(A4_PORTRAIT)).toEqual({ widthMm: 210, heightMm: 297 });
  });

  test('contentBoxPx for A4 portrait default margins is ((210-40)*96/25.4, (297-30)*96/25.4)', () => {
    const box = contentBoxPx(A4_PORTRAIT);
    expect(box.widthPx).toBeCloseTo(((210 - 40) * 96) / 25.4, 9);
    expect(box.heightPx).toBeCloseTo(((297 - 30) * 96) / 25.4, 9);
  });
});

describe('renderPages', () => {
  test('each page is a .pl-page sized in mm with mm padding, holding a .pl-content.wiki', () => {
    const content = makeContent();
    const host = document.createElement('div');
    const pages = renderPages(host, content, [{ placements: [{ blockIndex: 4 }] }, { placements: [] }], A4_LANDSCAPE);

    expect(pages).toHaveLength(2);
    expect(Array.from(host.children)).toEqual(pages);
    const [first] = pages;
    expect(first.classList.contains('pl-page')).toBe(true);
    expect(first.style.width).toBe('297mm');
    expect(first.style.height).toBe('210mm');
    expect(first.style.paddingTop).toBe('15mm');
    expect(first.style.paddingRight).toBe('20mm');
    expect(first.style.paddingBottom).toBe('15mm');
    expect(first.style.paddingLeft).toBe('20mm');
    const inner = first.querySelector('.pl-content') as HTMLElement;
    expect(inner.classList.contains('wiki')).toBe(true);
    expect(inner.classList.contains('custom-class')).toBe(true);
  });

  test('only the final frame is marked pl-page-last, even when overlay layers follow the frames', () => {
    const content = makeContent();
    const host = document.createElement('div');
    const pages = renderPages(
      host,
      content,
      [{ placements: [{ blockIndex: 4 }] }, { placements: [] }, { placements: [] }],
      A4_PORTRAIT,
    );
    // The page break and image resize layers are appended after the frames.
    host.appendChild(document.createElement('div'));

    expect(pages.map((p) => p.classList.contains('pl-page-last'))).toEqual([false, false, true]);
    expect(host.querySelectorAll('.pl-page-last')).toHaveLength(1);
  });

  test('rendering zero pages marks nothing', () => {
    const host = document.createElement('div');
    expect(renderPages(host, makeContent(), [], A4_PORTRAIT)).toEqual([]);
    expect(host.querySelector('.pl-page-last')).toBeNull();
  });

  test('renderPages replaces whatever the host held before', () => {
    const content = makeContent();
    const host = document.createElement('div');
    host.appendChild(document.createElement('span'));

    renderPages(host, content, [{ placements: [{ blockIndex: 4 }] }], A4_PORTRAIT);

    expect(host.querySelector('span')).toBeNull();
    expect(host.children).toHaveLength(1);
  });

  test('block clones carry data-pl-block and the source content is not touched', () => {
    const content = makeContent();
    const before = content.root.outerHTML;
    const host = document.createElement('div');

    const [pageEl] = renderPages(
      host,
      content,
      [{ placements: [{ blockIndex: 2 }, { blockIndex: 4 }] }],
      A4_PORTRAIT,
    );

    const tagged = Array.from(pageEl.querySelectorAll('[data-pl-block]'));
    expect(tagged.map((el) => el.getAttribute('data-pl-block'))).toEqual(['2', '4']);
    expect(tagged.map((el) => el.tagName)).toEqual(['P', 'H2']);
    expect(content.root.outerHTML).toBe(before);
    expect(content.blocks.some((b) => pageEl.contains(b))).toBe(false);
  });

  test('table fragment page contains thead clone plus exactly rows [start,end)', () => {
    const { pageEl } = renderOne({ placements: [{ blockIndex: 0, unitRange: { start: 1, end: 3 } }] });

    const table = pageEl.querySelector('[data-pl-block="0"] table') as HTMLTableElement;
    expect(Array.from(table.querySelectorAll('thead tr')).map((tr) => tr.textContent)).toEqual(['head']);
    expect(Array.from(table.querySelectorAll('tbody tr')).map((tr) => tr.textContent)).toEqual(['r1', 'r2']);
  });

  test('a unitRange covering the whole table renders every row', () => {
    const { pageEl } = renderOne({ placements: [{ blockIndex: 0, unitRange: { start: 0, end: 5 } }] });

    expect(pageEl.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(pageEl.querySelectorAll('thead tr')).toHaveLength(1);
  });

  test('code fragment keeps highlighted spans and contains exactly lines [start,end)', () => {
    // Lines: 0 "def f():", 1 "# one", 2 "# two", 3 'x = "a', 4 'b"'
    const { pageEl } = renderOne({ placements: [{ blockIndex: 1, unitRange: { start: 1, end: 4 } }] });

    const pre = pageEl.querySelector('[data-pl-block="1"]') as HTMLElement;
    const code = pre.querySelector('code') as HTMLElement;
    expect(code.textContent).toBe('# one\n# two\nx = "a\n');
    expect(code.querySelector('span.c')?.textContent).toBe('# one\n# two\n');
    expect(code.querySelector('span.s')?.textContent).toBe('"a\n');
    expect(code.querySelector('span.k')).toBeNull();
    expect(pre.querySelector('cite')?.textContent).toBe('a.py');
  });

  test('a code line lying inside a single highlighted span keeps that span', () => {
    const { pageEl } = renderOne({ placements: [{ blockIndex: 1, unitRange: { start: 1, end: 2 } }] });

    const code = pageEl.querySelector('[data-pl-block="1"] code') as HTMLElement;
    expect(code.textContent).toBe('# one\n');
    expect(code.querySelector('span.c')?.textContent).toBe('# one\n');
  });

  test('a unitRange covering every code line renders the whole block', () => {
    const content = makeContent();
    const host = document.createElement('div');
    const [pageEl] = renderPages(
      host,
      content,
      [{ placements: [{ blockIndex: 1, unitRange: { start: 0, end: 5 } }] }],
      A4_PORTRAIT,
    );

    const code = pageEl.querySelector('[data-pl-block="1"] code') as HTMLElement;
    expect(code.innerHTML).toBe((content.blocks[1].querySelector('code') as HTMLElement).innerHTML);
  });

  test('scaled placement gets .pl-scaled', () => {
    const { pageEl } = renderOne({ placements: [{ blockIndex: 4, scale: 0.5 }] });

    const scaled = pageEl.querySelector('.pl-scaled') as HTMLElement;
    expect(scaled).not.toBeNull();
    const inner = scaled.firstElementChild as HTMLElement;
    expect(inner.style.transform).toBe('scale(0.5)');
    expect(inner.style.transformOrigin).toBe('top left');
    expect(inner.querySelector('[data-pl-block="4"]')).not.toBeNull();
    // The visual height of a scaled placement is the whole content box.
    expect(scaled.style.height).toBe(`${contentBoxPx(A4_PORTRAIT).heightPx}px`);
  });

  test('readScale reports the wrapper scale, and 1 outside a scaled block', () => {
    const scaled = renderOne({ placements: [{ blockIndex: 4, scale: 0.5 }] }).pageEl;
    expect(readScale(scaled.querySelector('[data-pl-block="4"]') as HTMLElement)).toBe(0.5);
    const plain = renderOne({ placements: [{ blockIndex: 4 }] }).pageEl;
    expect(readScale(plain.querySelector('[data-pl-block="4"]') as HTMLElement)).toBe(1);
  });

  test('an unscaled placement is not marked .pl-scaled', () => {
    const { pageEl } = renderOne({ placements: [{ blockIndex: 4 }] });

    expect(pageEl.querySelector('.pl-scaled')).toBeNull();
  });

  test('the first block on a page loses its top margin', () => {
    const { pageEl } = renderOne({ placements: [{ blockIndex: 4 }, { blockIndex: 2 }] });

    expect((pageEl.querySelector('[data-pl-block="4"]') as HTMLElement).style.marginTop).toBe('0px');
    expect((pageEl.querySelector('[data-pl-block="2"]') as HTMLElement).style.marginTop).toBe('');
  });

  test('image clones carry data-pl-image with their index in content.images', () => {
    const { pageEl } = renderOne({ placements: [{ blockIndex: 2 }, { blockIndex: 3 }] });

    const img = pageEl.querySelector('img') as HTMLElement;
    expect(img.getAttribute('data-pl-image')).toBe('0');
    const drawio = pageEl.querySelector('[data-pl-block="3"]') as HTMLElement;
    expect(drawio.getAttribute('data-pl-image')).toBe('1');
  });

  test('column clones carry data-pl-columns with their index in content.columns, at any depth, keeping the applied flex', () => {
    const root = document.createElement('div');
    root.className = 'wiki';
    root.innerHTML =
      '<div class="f2_container"><div>a</div><div>b</div></div><section><p>x</p><div class="f2_container"><div style="flex: 30 1 0px">c</div><div style="flex: 70 1 0px">d</div></div></section>';
    const blocks = Array.from(root.children) as HTMLElement[];
    const columnEls = Array.from(root.querySelectorAll<HTMLElement>('.f2_container'));
    const content: CapturedContent = { root, blocks, images: [], columns: columnEls.map((element) => ({ element })), fits: [] };
    const [pageEl] = renderPages(document.createElement('div'), content, [{ placements: [{ blockIndex: 0 }, { blockIndex: 1 }] }], A4_PORTRAIT);

    const tagged = Array.from(pageEl.querySelectorAll<HTMLElement>('[data-pl-columns]'));
    expect(tagged.map((el) => [el.getAttribute('data-pl-columns'), el.textContent])).toEqual([
      ['0', 'ab'],
      ['1', 'cd'],
    ]);
    expect(Array.from(tagged[1].children).map((c) => (c as HTMLElement).style.flex)).toEqual(['30 1 0px', '70 1 0px']);
    expect(columnEls.some((el) => el.hasAttribute('data-pl-columns'))).toBe(false);
  });
});

describe('renderPages fit targets', () => {
  test('every fragment of a split table or code block carries data-pl-fit and the fit classes', () => {
    const base = makeContent();
    const table = base.root.querySelector('table') as HTMLElement;
    const pre = base.root.querySelector('pre') as HTMLElement;
    table.classList.add('pl-fit', 'pl-fit-wrap');
    pre.classList.add('pl-fit', 'pl-fit-wrap');
    const content: CapturedContent = {
      ...base,
      fits: [
        { element: table, kind: 'table' },
        { element: pre, kind: 'code' },
      ],
    };
    const pages: Page[] = [
      { placements: [{ blockIndex: 0, unitRange: { start: 0, end: 2 } }, { blockIndex: 1, unitRange: { start: 0, end: 2 } }] },
      { placements: [{ blockIndex: 0, unitRange: { start: 2, end: 5 } }, { blockIndex: 1, unitRange: { start: 2, end: 5 } }] },
    ];
    const frames = renderPages(document.createElement('div'), content, pages, A4_PORTRAIT);

    for (const frame of frames) {
      const tagged = Array.from(frame.querySelectorAll<HTMLElement>('[data-pl-fit]'));
      expect(tagged.map((el) => [el.tagName, el.getAttribute('data-pl-fit'), el.className])).toEqual([
        ['TABLE', '0', 'table pl-fit pl-fit-wrap'],
        ['PRE', '1', 'pl-fit pl-fit-wrap'],
      ]);
    }
    expect(frames[1].querySelector('code')?.textContent).not.toBe(frames[0].querySelector('code')?.textContent);
    expect(table.hasAttribute('data-pl-fit') || pre.hasAttribute('data-pl-fit')).toBe(false);
  });
});
