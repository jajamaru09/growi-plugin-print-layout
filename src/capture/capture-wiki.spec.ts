import { afterEach, describe, expect, test, vi } from 'vitest';
import { computeBlockAnchors, fnv1a32Hex } from '../layout';
import { captureWiki, classifyBlock, findMainWiki, isTwoColumnFlex, splitLeaves } from './capture-wiki';
import { stripInteractiveChrome } from './strip-chrome';

const SVG_NS = 'http://www.w3.org/2000/svg';

const XML_A = '<mxfile><diagram id="a">A</diagram></mxfile>';
const XML_B = '<mxfile><diagram id="b">B</diagram></mxfile>';

// Mirrors the GROWI 8.0.4 markup of a rendered drawio block.
const drawioWrapper = (xml: string, label: string): string => `
  <div class="drawio-viewer-with-edit-button DrawioViewerWithEditButton-module-scss-module__x__drawio-viewer-with-edit-button">
    <button class="btn btn-sm btn-outline-secondary btn-edit-drawio"><span class="material-symbols-outlined me-1">edit</span>Edit</button>
    <div class="drawio-viewer p-2"><div>
      <div class="mxgraph" data-mxgraph='${JSON.stringify({ xml }).replace(/'/g, '&#39;')}'>
        <svg xmlns="${SVG_NS}"><text>${label}</text></svg>
      </div>
    </div></div>
  </div>`;

const mainWikiHtml = `
  <div class="wiki">
    <h2 id="photos">Photos</h2>
    <p><button class="border-0 bg-transparent p-0"><img alt="" src="/attachment/one"></button></p>
    ${drawioWrapper(XML_A, 'inline-a')}
    <div class="editable-with-handsontable"><button class="handsontable-modal-trigger"><span>edit_note</span></button>
      <table class="table table-bordered"><thead><tr><th>h</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
    </div>
    <p><button class="border-0 bg-transparent p-0"><img alt="" src="/attachment/two"></button></p>
    ${drawioWrapper(XML_B, 'inline-b')}
    <pre><cite class="cbs-filename-label">a.py</cite><div><code class="language-python">x = 1
y = 2
</code></div></pre>
  </div>`;

const staticSvg = (label: string): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('data-static', label);
  return svg;
};

const mountMainWiki = (): HTMLElement => {
  document.body.innerHTML = mainWikiHtml;
  return document.querySelector<HTMLElement>('.wiki') as HTMLElement;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('findMainWiki', () => {
  test('findMainWiki ignores a .wiki inside the comment area', () => {
    document.body.innerHTML = `
      <div class="page-comments"><div id="page-comments-list" class="page-comments-list">
        <div class="page-comment"><div class="page-comment-body"><div><div class="wiki comment"><p>comment</p></div></div></div></div>
      </div></div>
      <div class="main"><div class="wiki"><p>body</p></div></div>`;

    expect(findMainWiki(document)?.textContent).toBe('body');
  });

  test('ignores the editor preview .wiki', () => {
    document.body.innerHTML = `
      <div id="page-editor"><div class="page-editor-preview-container">
        <div class="Preview-module-scss-module__N2Gtsq__page-editor-preview-body"><div><div class="wiki"><p>preview</p></div></div></div>
      </div></div>
      <div class="main"><div class="wiki"><p>body</p></div></div>`;

    expect(findMainWiki(document)?.textContent).toBe('body');
  });

  test('returns null when only comment / preview .wiki elements exist', () => {
    document.body.innerHTML = `
      <div class="page-comments"><div class="wiki comment"><p>c</p></div></div>
      <div id="page-editor-preview-body"><div class="wiki"><p>p</p></div></div>`;

    expect(findMainWiki(document)).toBeNull();
  });
});

describe('captureWiki', () => {
  test('captureWiki does not mutate the source DOM', async () => {
    const source = mountMainWiki();
    const before = source.outerHTML;

    const content = await captureWiki(source, async () => staticSvg('s'));

    expect(source.outerHTML).toBe(before);
    expect(content.root).not.toBe(source);
    expect(source.contains(content.root)).toBe(false);
  });

  test('drawio wrapper is replaced by the svg returned from toStaticSvg; on null it keeps a clone of the inline svg', async () => {
    const source = mountMainWiki();
    const toStaticSvg = vi.fn(async (wrapper: HTMLElement) =>
      wrapper.textContent?.includes('inline-a') ? staticSvg('static-a') : null,
    );

    const { root } = await captureWiki(source, toStaticSvg);

    expect(toStaticSvg).toHaveBeenCalledTimes(2);
    expect(root.querySelector('[class*="drawio-viewer-with-edit-button"]')).toBeNull();
    expect(root.querySelector('.btn-edit-drawio')).toBeNull();
    const svgs = Array.from(root.querySelectorAll('svg'));
    expect(svgs.map((s) => s.getAttribute('data-static'))).toEqual(['static-a', null]);
    expect(svgs[1].textContent).toBe('inline-b');
    // The fallback svg is a copy, not the node still shown on the page.
    expect(source.contains(svgs[1])).toBe(false);
  });

  test('the static drawio svg takes the on-page width of the diagram, capped at 100%, with auto height', async () => {
    const source = mountMainWiki();
    const inline = Array.from(source.querySelectorAll<SVGSVGElement>('.mxgraph svg'));
    inline[0].getBoundingClientRect = () => new DOMRect(0, 0, 357, 77);

    const { root } = await captureWiki(source, async () => staticSvg('s'));

    const [first, second] = Array.from(root.querySelectorAll<SVGSVGElement>('[data-print-layout-drawio] > svg'));
    expect(first.style.width).toBe('357px');
    expect(first.style.maxWidth).toBe('100%');
    expect(first.style.height).toBe('auto');
    // Without a layout box (0 width) the svg keeps its intrinsic width.
    expect(second.style.width).toBe('');
    expect(second.style.maxWidth).toBe('100%');
    expect(second.style.height).toBe('auto');
  });

  test('a fallback inline svg loses the viewer min sizes so it can shrink to fit', async () => {
    const source = mountMainWiki();
    for (const svg of Array.from(source.querySelectorAll<SVGSVGElement>('.mxgraph svg'))) {
      svg.style.minWidth = '357px';
      svg.style.minHeight = '77px';
    }

    const { root } = await captureWiki(source, async () => null);

    for (const svg of Array.from(root.querySelectorAll<SVGSVGElement>('[data-print-layout-drawio] > svg'))) {
      expect(svg.style.minWidth).toBe('0px');
      expect(svg.style.minHeight).toBe('0px');
      expect(svg.style.maxWidth).toBe('100%');
    }
  });

  test('a throwing toStaticSvg falls back to the inline svg', async () => {
    const source = mountMainWiki();

    const { root } = await captureWiki(source, async () => {
      throw new Error('viewer failed');
    });

    expect(Array.from(root.querySelectorAll('svg')).map((s) => s.textContent)).toEqual([
      'inline-a',
      'inline-b',
    ]);
  });

  test('blocks are the direct element children of the captured root', async () => {
    const source = mountMainWiki();

    const { root, blocks } = await captureWiki(source, async () => staticSvg('s'));

    expect(blocks).toEqual(Array.from(root.children));
    expect(blocks).toHaveLength(7);
  });

  test('images lists img by src and drawio by xml hash in document order', async () => {
    const source = mountMainWiki();

    const { root, images } = await captureWiki(source, async () => staticSvg('s'));

    expect(images.map(({ kind, key }) => ({ kind, key }))).toEqual([
      { kind: 'img', key: '/attachment/one' },
      { kind: 'drawio', key: fnv1a32Hex(XML_A) },
      { kind: 'img', key: '/attachment/two' },
      { kind: 'drawio', key: fnv1a32Hex(XML_B) },
    ]);
    for (const image of images) expect(root.contains(image.element)).toBe(true);
    expect(images[1].element.querySelector('svg')).not.toBeNull();
  });

  test('a drawio block without readable xml gets an empty key', async () => {
    document.body.innerHTML = `<div class="wiki">${drawioWrapper(XML_A, 'x').replace(/data-mxgraph='[^']*'/, "data-mxgraph='not json'")}</div>`;
    const source = document.querySelector<HTMLElement>('.wiki') as HTMLElement;

    const { images } = await captureWiki(source, async () => null);

    expect(images.map(({ kind, key }) => ({ kind, key }))).toEqual([{ kind: 'drawio', key: '' }]);
  });

  test('an img inside a static drawio svg is not listed as an image', async () => {
    const source = mountMainWiki();
    const withHtmlLabel = (): SVGSVGElement => {
      const svg = staticSvg('s');
      const foreign = document.createElementNS(SVG_NS, 'foreignObject');
      foreign.appendChild(document.createElement('img')).setAttribute('src', '/label.png');
      svg.appendChild(foreign);
      return svg;
    };

    const { images } = await captureWiki(source, async () => withHtmlLabel());

    expect(images.map((i) => i.key)).not.toContain('/label.png');
    expect(images).toHaveLength(4);
  });

  // Markup captured live from GROWI 8.0.4: logged-in users get heading, table
  // and drawio edit buttons that a guest does not.
  const heading = (editable: boolean): string =>
    `<h2 id="diagrams" class="position-relative revision-head"><a href="#diagrams" class="d-none d-md-inline revision-head-link position-absolute">#</a>Diagrams${
      editable
        ? '<span class="revision-head-edit-button"><button type="button" class="border-0 bg-transparent p-0"><span class="material-symbols-outlined" aria-hidden="true">edit_square</span></button></span>'
        : ''
    }</h2>`;
  const table = (editable: boolean): string =>
    `<div class="editable-with-handsontable">${
      editable
        ? '<button type="button" class="handsontable-modal-trigger"><span class="material-symbols-outlined" aria-hidden="true">edit_square</span></button>'
        : ''
    }<table class="table table-bordered"><thead><tr><th>No</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>`;
  const drawio = (editable: boolean): string =>
    `<div class="drawio-viewer-with-edit-button">${
      editable
        ? '<button type="button" class="btn btn-sm btn-outline-secondary btn-edit-drawio"><span class="material-symbols-outlined me-1" aria-hidden="true">edit_square</span>編集</button>'
        : ''
    }<div class="drawio-viewer p-2"><div><div class="mxgraph" data-mxgraph='${JSON.stringify({ xml: XML_A })}'><svg xmlns="${SVG_NS}"><text>StartEnd</text></svg></div></div></div></div>`;
  const photo =
    '<p><button type="button" class="border-0 bg-transparent p-0" aria-label="photo1"><img alt="photo1" src="/attachment/p1"></button></p>';
  const captureAs = async (editable: boolean) => {
    document.body.innerHTML = `<div class="wiki">${heading(editable)}${table(editable)}${drawio(editable)}${photo}</div>`;
    const source = document.querySelector<HTMLElement>('.wiki') as HTMLElement;
    // Null keeps the inline svg, so the drawio block is not rebuilt from scratch.
    return captureWiki(source, async () => null);
  };

  test('block anchors are identical whether or not the viewer gets edit buttons and permalinks', async () => {
    const editor = await captureAs(true);
    const guest = await captureAs(false);

    expect(computeBlockAnchors(editor.blocks)).toEqual(computeBlockAnchors(guest.blocks));
    expect(editor.blocks.map((b) => b.textContent)).toEqual(['Diagrams', 'No1', 'StartEnd', '']);
  });

  test('captured blocks keep their images after the interactive chrome is removed', async () => {
    const { root, images } = await captureAs(true);

    expect(root.querySelector('button')).toBeNull();
    expect(images.map((i) => i.key)).toEqual([fnv1a32Hex(XML_A), '/attachment/p1']);
    expect(images.every((i) => root.contains(i.element))).toBe(true);
  });
});

describe('isTwoColumnFlex', () => {
  const el = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.firstElementChild as HTMLElement;
  };

  test('a row flex container with exactly two element children is a two-column layout', () => {
    expect(isTwoColumnFlex(el('<div style="display:flex"><div>a</div><div>b</div></div>'))).toBe(true);
    expect(isTwoColumnFlex(el('<div style="display:flex;flex-direction:row-reverse"><div>a</div><div>b</div></div>'))).toBe(true);
  });

  test('only display:flex counts, not inline-flex', () => {
    expect(isTwoColumnFlex(el('<div style="display:inline-flex"><div>a</div><div>b</div></div>'))).toBe(false);
  });

  test('three children, display:block or flex-direction:column are not', () => {
    expect(isTwoColumnFlex(el('<div style="display:flex"><div>a</div><div>b</div><div>c</div></div>'))).toBe(false);
    expect(isTwoColumnFlex(el('<div style="display:block"><div>a</div><div>b</div></div>'))).toBe(false);
    expect(isTwoColumnFlex(el('<div style="display:flex;flex-direction:column"><div>a</div><div>b</div></div>'))).toBe(false);
  });

  test('the style comes from the injected getter, e.g. a CSS class resolved elsewhere', () => {
    const container = el('<div class="f2_container"><div class="f2_item">a</div><div class="f2_item">b</div></div>');
    const style = document.createElement('div').style;
    style.display = 'flex';
    expect(isTwoColumnFlex(container, () => style)).toBe(true);
  });
});

describe('captureWiki columns', () => {
  const twoColumns = (left: string, right: string, attrs = 'style="display:flex"'): string =>
    `<div ${attrs}><div>${left}</div><div>${right}</div></div>`;

  test('lists two-column flex elements at any depth in document order, as elements of the captured root', async () => {
    document.body.innerHTML = `<div class="wiki"><p>intro</p>${twoColumns('L1', 'R1')}<section>${twoColumns('L2', 'R2')}</section></div>`;
    const source = document.querySelector<HTMLElement>('.wiki') as HTMLElement;
    const { root, columns } = await captureWiki(source, async () => null);

    expect(columns.map((c) => c.element.textContent)).toEqual(['L1R1', 'L2R2']);
    expect(columns.every((c) => root.contains(c.element) && !source.contains(c.element))).toBe(true);
  });

  test('display comes from the live source element, so a class-defined flex is found', async () => {
    document.body.innerHTML = `<div class="wiki">${twoColumns('a', 'b', 'class="f2_container"')}<div class="plain"><p>x</p><p>y</p></div></div>`;
    const source = document.querySelector<HTMLElement>('.wiki') as HTMLElement;
    const seen: Element[] = [];
    const getStyle = (e: Element): CSSStyleDeclaration => {
      seen.push(e);
      const style = document.createElement('div').style;
      if (e.classList.contains('f2_container')) style.display = 'flex';
      return style;
    };
    const { columns } = await captureWiki(source, async () => null, getStyle);

    expect(columns.map((c) => c.element.className)).toEqual(['f2_container']);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((e) => source.contains(e))).toBe(true);
  });

  test('edit buttons are not counted as columns and flex labels inside a drawio svg are ignored', async () => {
    const flexLabel = '<div style="display:flex"><div>x</div><div>y</div></div>';
    document.body.innerHTML = `<div class="wiki">
      <div style="display:flex"><button class="revision-head-edit-button">e</button><div>a</div><div>b</div></div>
      <div class="drawio-viewer-with-edit-button"><div class="drawio-viewer"><div><div class="mxgraph" data-mxgraph='${JSON.stringify({ xml: XML_A })}'>
        <svg xmlns="${SVG_NS}"><foreignObject>${flexLabel}</foreignObject></svg></div></div></div></div>
    </div>`;
    const source = document.querySelector<HTMLElement>('.wiki') as HTMLElement;
    const { columns } = await captureWiki(source, async () => null);

    expect(columns.map((c) => c.element.textContent)).toEqual(['ab']);
  });

  test('column anchors use tag + text hash + occurrence among the columns', async () => {
    document.body.innerHTML = `<div class="wiki">${twoColumns('same', 'text')}<p>between</p>${twoColumns('same', 'text')}</div>`;
    const source = document.querySelector<HTMLElement>('.wiki') as HTMLElement;
    const { columns } = await captureWiki(source, async () => null);
    const anchors = computeBlockAnchors(columns.map((c) => c.element));

    expect(anchors.map((a) => [a.tag, a.occurrence])).toEqual([
      ['div', 0],
      ['div', 1],
    ]);
    expect(anchors[0].textHash).toBe(anchors[1].textHash);
  });
});

describe('classifyBlock', () => {
  const el = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html.trim();
    return host.firstElementChild as HTMLElement;
  };

  test('classifyBlock: table → table, pre → code, p with only img → media, div.flex → other', () => {
    expect(classifyBlock(el('<table><tbody><tr><td>1</td></tr></tbody></table>'))).toBe('table');
    expect(classifyBlock(el('<pre><code>x</code></pre>'))).toBe('code');
    expect(
      classifyBlock(el('<p><button class="border-0"><img src="/attachment/one"></button></p>')),
    ).toBe('media');
    expect(
      classifyBlock(
        el('<div style="display:flex;gap:16px"><div style="flex:1"><p>a</p></div><div style="flex:1"><p>b</p></div></div>'),
      ),
    ).toBe('other');
  });

  test('a GROWI table wrapper is a table once capture has stripped its edit button', () => {
    const block = el(
      '<div class="editable-with-handsontable"><button class="handsontable-modal-trigger"><span>edit_note</span></button><table><tbody><tr><td>1</td></tr></tbody></table></div>',
    );
    stripInteractiveChrome(block);
    expect(classifyBlock(block)).toBe('table');
  });

  test('a wrapper whose only element child is a pre is code', () => {
    expect(classifyBlock(el('<div class="code-wrapper"><pre><code>x</code></pre></div>'))).toBe('code');
  });

  test('a wrapper holding a table plus other content is not a table', () => {
    expect(classifyBlock(el('<div><p>caption</p><table><tbody><tr><td>1</td></tr></tbody></table></div>'))).toBe(
      'other',
    );
  });

  test('a paragraph with text and an image is other', () => {
    expect(classifyBlock(el('<p>see <img src="/x.png"></p>'))).toBe('other');
  });

  test('captureWiki marks a stacking wrapper and its nested wrappers, but not a two-column flex', async () => {
    document.body.innerHTML = `<div class="wiki"><div class="steps"><h2>1</h2><div style="display:flex"><div><p>a</p></div><div><p>b</p></div></div><div class="inner"><p>c</p><p>d</p></div></div></div>`;
    const content = await captureWiki(document.querySelector('.wiki') as HTMLElement, async () => null);
    const [block] = content.blocks;
    expect(classifyBlock(block)).toBe('container');
    expect(splitLeaves(block).map((el) => el.textContent)).toEqual(['1', 'ab', 'c', 'd']);
  });

  test('a wrapper with text of its own stays one block', async () => {
    document.body.innerHTML = `<div class="wiki"><div>text <p>a</p><p>b</p></div></div>`;
    const content = await captureWiki(document.querySelector('.wiki') as HTMLElement, async () => null);
    expect(classifyBlock(content.blocks[0])).toBe('other');
  });

  // Mirrors the real page's custom CSS: .f2_container{display:flex;flex-wrap:wrap} .f2_item{flex:0 0 calc(50% - 10px)}.
  const flexStyle = (e: Element): CSSStyleDeclaration => {
    const style = document.createElement('div').style;
    style.display = e.classList.contains('f2_container') ? 'flex' : 'block';
    return style;
  };

  test('a wrapping flex of many items is a container whose leaves are the items', async () => {
    document.body.innerHTML = `<div class="wiki"><div class="f2_container"><div class="f2_item"><h2>1</h2><p>a</p></div><div class="f2_item"><p>b</p></div><div class="f2_item"><h2>2</h2></div><div class="f2_item"><p>c</p></div></div></div>`;
    const source = document.querySelector('.wiki') as HTMLElement;
    const { blocks } = await captureWiki(source, async () => null, flexStyle);

    expect(classifyBlock(blocks[0])).toBe('container');
    // Items are cells of a line, so capture must not descend into them.
    expect(splitLeaves(blocks[0]).map((el) => el.className)).toEqual(['f2_item', 'f2_item', 'f2_item', 'f2_item']);
  });

  test('a two-column flex stays one block, so the ratio handles keep it whole', async () => {
    document.body.innerHTML = `<div class="wiki"><div class="f2_container"><div class="f2_item"><p>a</p></div><div class="f2_item"><p>b</p></div></div></div>`;
    const source = document.querySelector('.wiki') as HTMLElement;
    const { blocks } = await captureWiki(source, async () => null, flexStyle);

    expect(blocks[0].hasAttribute('data-pl-split')).toBe(false);
    expect(classifyBlock(blocks[0])).toBe('other');
  });

  test('a captured drawio block is media', async () => {
    const source = mountMainWiki();
    const { blocks } = await captureWiki(source, async () => staticSvg('s'));

    expect(blocks.map(classifyBlock)).toEqual(['other', 'media', 'media', 'table', 'media', 'media', 'code']);
  });
});

describe('captureWiki fits', () => {
  const capture = async (html: string) => {
    document.body.innerHTML = `<div class="wiki">${html}</div>`;
    const source = document.querySelector<HTMLElement>('.wiki') as HTMLElement;
    return captureWiki(source, async () => null);
  };
  const cell = (text: string): string => `<table><tbody><tr><td>${text}</td></tr></tbody></table>`;

  test('lists outermost tables and code blocks in document order, as elements of the captured root', async () => {
    const { root, fits } = await capture(`<div>${cell('t1')}</div><pre><code>c1</code></pre>${cell('t2')}`);
    expect(fits.map((f) => [f.kind, f.element.tagName, f.element.textContent])).toEqual([
      ['table', 'TABLE', 't1'],
      ['code', 'PRE', 'c1'],
      ['table', 'TABLE', 't2'],
    ]);
    expect(fits.every((f) => root.contains(f.element))).toBe(true);
  });

  test('a table nested in another table cell is not a target; only the outer one is', async () => {
    const { fits } = await capture(`<table><tbody><tr><td>outer${cell('inner')}</td></tr></tbody></table>`);
    expect(fits).toHaveLength(1);
    expect(fits[0].element.textContent).toContain('outer');
  });

  test('a code block inside a two-column item is a target', async () => {
    const { fits } = await capture('<div class="f2_container"><div class="f2_item"><pre>x</pre></div><div class="f2_item">y</div></div>');
    expect(fits.map((f) => f.kind)).toEqual(['code']);
  });

  test('code blocks and tables inside a drawio subtree are not targets', async () => {
    const { fits } = await capture(`
      <div class="drawio-viewer-with-edit-button"><div class="drawio-viewer"><div><div class="mxgraph" data-mxgraph='${JSON.stringify({ xml: XML_A })}'>
        <svg xmlns="${SVG_NS}"><foreignObject><pre>in-svg</pre>${cell('x')}</foreignObject></svg></div></div></div></div>
      <pre>kept</pre>`);
    expect(fits.map((f) => f.element.textContent)).toEqual(['kept']);
  });

  test('fit anchors use tag + text hash + occurrence among the targets', async () => {
    const { fits } = await capture('<pre>same</pre><p>between</p><pre>same</pre>');
    const anchors = computeBlockAnchors(fits.map((f) => f.element));
    expect(anchors.map((a) => [a.tag, a.occurrence])).toEqual([
      ['pre', 0],
      ['pre', 1],
    ]);
  });
});
