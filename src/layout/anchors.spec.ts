import { describe, expect, test } from 'vitest';
import {
  computeBlockAnchors,
  computeImageAnchors,
  fnv1a32Hex,
  matchAnchors,
  normalizeText,
} from './anchors';
import type { BlockAnchor, BreakEntry } from './types';
import { defaultLayout, parseLayout } from './validate';

const blocksOf = (html: string): Element[] => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return Array.from(root.children);
};
const eq = (a: BlockAnchor, b: BlockAnchor) =>
  a.tag === b.tag && a.textHash === b.textHash && a.occurrence === b.occurrence;
const entry = (anchor: BlockAnchor): BreakEntry => ({ anchor });

describe('normalizeText', () => {
  test('collapses whitespace incl. newlines and NBSP, trims, caps at 200', () => {
    expect(normalizeText('  a\n\t b  c　 ')).toBe('a b c');
    expect(normalizeText('x'.repeat(300))).toHaveLength(200);
  });
});

describe('fnv1a32Hex', () => {
  test('empty string is 811c9dc5 and output is always 8 hex chars', () => {
    expect(fnv1a32Hex('')).toBe('811c9dc5');
    expect(fnv1a32Hex('a')).toBe('e40c292c');
    for (const s of ['', 'a', '概要', 'x'.repeat(500)]) {
      expect(fnv1a32Hex(s)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe('computeBlockAnchors', () => {
  test('same heading text twice gets occurrence 0 and 1', () => {
    const a = computeBlockAnchors(
      blocksOf('<h2>概要</h2><p>x</p><h2>概要</h2>'),
    );
    expect(a.map((x) => x.occurrence)).toEqual([0, 0, 1]);
    expect(a[0].tag).toBe('h2');
    expect(a[0].textHash).toBe(a[2].textHash);
  });

  test('editing a paragraph keeps anchors of other blocks unchanged', () => {
    const before = computeBlockAnchors(
      blocksOf('<h2>A</h2><p>one</p><p>two</p>'),
    );
    const after = computeBlockAnchors(
      blocksOf('<h2>A</h2><p>one edited</p><p>two</p>'),
    );
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[2]);
    expect(after[1]).not.toEqual(before[1]);
  });

  test('whitespace-only differences do not change the anchor', () => {
    const a = computeBlockAnchors(blocksOf('<p>a  b</p>'));
    const b = computeBlockAnchors(blocksOf('<p>a\n b</p>'));
    expect(a).toEqual(b);
  });

  test('custom elements yield anchors that pass parseLayout', () => {
    const anchors = computeBlockAnchors(
      blocksOf('<my-widget>t</my-widget><h1>t</h1><p></p>'),
    );
    expect(anchors[0].tag).toBe('mywidget');
    const layout = {
      ...defaultLayout('p', 'r'),
      breaks: anchors.map((anchor) => ({ anchor })),
    };
    const r = parseLayout(JSON.parse(JSON.stringify(layout)));
    expect(r.layout?.breaks).toHaveLength(3);
  });
});

describe('matchAnchors', () => {
  const heading = (occurrence: number): BlockAnchor => ({
    tag: 'h2',
    textHash: fnv1a32Hex('概要'),
    occurrence,
  });

  test('a break anchored to a deleted heading ends up in unmatched', () => {
    const current = computeBlockAnchors(blocksOf('<p>x</p>'));
    const r = matchAnchors([entry(heading(0))], current, eq);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatched).toHaveLength(1);
  });

  test('when the second of two identical headings is deleted, only occurrence 0 matches', () => {
    const r = matchAnchors(
      [entry(heading(0)), entry(heading(1))],
      [heading(0)],
      eq,
    );
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].entry.anchor.occurrence).toBe(0);
    expect(r.unmatched).toHaveLength(1);
  });

  test('never assigns two saved entries to one current element', () => {
    const r = matchAnchors(
      [entry(heading(0)), entry(heading(0))],
      [heading(0)],
      eq,
    );
    expect(r.matched).toHaveLength(1);
    expect(r.unmatched).toHaveLength(1);
  });
});

describe('computeImageAnchors', () => {
  test('same src twice gets occurrence 0,1; drawio keyed by xml hash', () => {
    const el = document.createElement('div');
    const key = fnv1a32Hex('<mxfile/>');
    const a = computeImageAnchors([
      { element: el, kind: 'img', key: '/a.png' },
      { element: el, kind: 'img', key: '/a.png' },
      { element: el, kind: 'drawio', key },
      { element: el, kind: 'drawio', key },
    ]);
    expect(a.map((x) => x.occurrence)).toEqual([0, 1, 0, 1]);
    expect(a[2]).toEqual({ kind: 'drawio', key, occurrence: 0 });
  });

  test('empty and over-long keys are hashed and survive a parseLayout round trip', () => {
    const el = document.createElement('div');
    const long = `data:image/png;base64,${'A'.repeat(5000)}`;
    const a = computeImageAnchors([
      { element: el, kind: 'img', key: '' },
      { element: el, kind: 'img', key: long },
      { element: el, kind: 'img', key: long },
      { element: el, kind: 'img', key: '/a.png' },
    ]);
    expect(a[0].key).toMatch(/^h:[0-9a-f]{8}$/);
    expect(a[1].key).toMatch(/^h:[0-9a-f]{8}$/);
    expect(a.map((x) => x.occurrence)).toEqual([0, 0, 1, 0]);
    const layout = {
      ...defaultLayout('p', 'r'),
      images: a.map((anchor) => ({ anchor, widthPercent: 50 })),
    };
    const r = parseLayout(JSON.parse(JSON.stringify(layout)));
    expect(r.layout?.images).toHaveLength(4);
  });
});

describe('computeBlockAnchors for blocks without text', () => {
  const photoBlocks = (srcs: string[]): Element[] =>
    blocksOf(`<h2>Photos</h2>${srcs.map((src) => `<p><img alt="" src="${src}"></p>`).join('')}<p>end</p>`);

  test('removing an earlier photo keeps a break on a later photo matched to that photo', () => {
    const before = computeBlockAnchors(photoBlocks(['/p1', '/p2', '/p3']));
    const after = computeBlockAnchors(photoBlocks(['/p2', '/p3']));
    const r = matchAnchors([entry(before[3])], after, eq);
    expect(r.matched.map((m) => m.index)).toEqual([2]);
    expect(r.unmatched).toHaveLength(0);
  });

  test('a break on a deleted photo becomes unmatched instead of moving to another photo', () => {
    const before = computeBlockAnchors(photoBlocks(['/p1', '/p2', '/p3']));
    const after = computeBlockAnchors(photoBlocks(['/p2', '/p3']));
    const r = matchAnchors([entry(before[1])], after, eq);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatched).toHaveLength(1);
  });

  test('the same photo twice is told apart by occurrence', () => {
    const a = computeBlockAnchors(photoBlocks(['/p1', '/p1']));
    expect(a[1].textHash).toBe(a[2].textHash);
    expect([a[1].occurrence, a[2].occurrence]).toEqual([0, 1]);
  });

  test('image-only two-column layouts are keyed by their images', () => {
    const columns = (srcs: string[][]): Element[] =>
      blocksOf(
        srcs
          .map(([l, r]) => `<div style="display:flex"><div><img src="${l}"></div><div><img src="${r}"></div></div>`)
          .join(''),
      );
    const before = computeBlockAnchors(columns([['/a', '/b'], ['/c', '/d']]));
    const after = computeBlockAnchors(columns([['/c', '/d']]));
    expect(matchAnchors([entry(before[1])], after, eq).matched.map((m) => m.index)).toEqual([0]);
    expect(matchAnchors([entry(before[0])], after, eq).unmatched).toHaveLength(1);
  });

  test('a block with neither text nor images is keyed by its tag and child tags', () => {
    const a = computeBlockAnchors(blocksOf('<hr><div><br></div><div><canvas></canvas></div><hr>'));
    expect(a[0].textHash).toBe(a[3].textHash);
    expect([a[0].occurrence, a[3].occurrence]).toEqual([0, 1]);
    expect(a[1].textHash).not.toBe(a[2].textHash);
  });

  test('textless anchors survive a parseLayout round trip', () => {
    const anchors = computeBlockAnchors(photoBlocks([`data:image/png;base64,${'A'.repeat(5000)}`]));
    const layout = { ...defaultLayout('p', 'r'), breaks: anchors.map((anchor) => ({ anchor })) };
    expect(parseLayout(JSON.parse(JSON.stringify(layout))).layout?.breaks).toHaveLength(3);
  });
});

describe('computeBlockAnchors around drawio diagrams', () => {
  const diagram = (key: string, svg: string) => `<div data-print-layout-drawio="${key}">${svg}</div>`;
  const STATIC_SVG = '<svg><text>Start</text><text>End</text></svg>';
  // The viewer's inline svg puts each label twice: as HTML in a foreignObject and as fallback text.
  const INLINE_SVG =
    '<svg><switch><foreignObject><div>Start</div></foreignObject><text>Start</text></switch><switch><foreignObject><div>End</div></foreignObject><text>End</text></switch></svg>';

  test('the static render and the inline-svg fallback give the same anchor', () => {
    const html = (svg: string) => `<div><p>caption</p>${diagram('k1', svg)}</div>${diagram('k2', svg)}`;
    expect(computeBlockAnchors(blocksOf(html(STATIC_SVG)))).toEqual(computeBlockAnchors(blocksOf(html(INLINE_SVG))));
  });

  test('a diagram-only block is keyed by its diagram', () => {
    const before = computeBlockAnchors(blocksOf(diagram('k1', STATIC_SVG) + diagram('k2', STATIC_SVG)));
    const after = computeBlockAnchors(blocksOf(diagram('k2', INLINE_SVG)));
    expect(before[0].textHash).not.toBe(before[1].textHash);
    expect(matchAnchors([entry(before[1])], after, eq).matched.map((m) => m.index)).toEqual([0]);
  });

  test('blocks with the same text but different diagrams get different anchors', () => {
    const a = computeBlockAnchors(blocksOf(`<div><p>c</p>${diagram('k1', '')}</div><div><p>c</p>${diagram('k2', '')}</div>`));
    expect(a[0].textHash).not.toBe(a[1].textHash);
  });
});
