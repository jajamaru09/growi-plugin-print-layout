import { describe, expect, test } from 'vitest';

import { defaultLayout, parseLayout } from './validate';

const valid = {
  ...defaultLayout('page1', 'rev1'),
  breaks: [{ anchor: { tag: 'h2', textHash: 'deadbeef', occurrence: 0 } }],
  images: [
    {
      anchor: { kind: 'img' as const, key: '/a.png', occurrence: 1 },
      widthPercent: 60,
    },
  ],
  columns: [{ anchor: { tag: 'div', textHash: '0badcafe', occurrence: 1 }, leftPercent: 70 }],
  fits: [
    { anchor: { tag: 'table', textHash: '0badcafe', occurrence: 0 }, mode: 'shrink' as const },
    { anchor: { tag: 'pre', textHash: 'deadbeef', occurrence: 2 }, mode: 'scale' as const, scalePercent: 65 },
  ],
  hidden: [
    { anchor: { tag: 'h3', textHash: 'deadbeef', parents: ['0badcafe', '12345678'], occurrence: 1 }, label: '概要' },
  ],
};

const hiddenAnchor = { tag: 'h2', textHash: 'deadbeef', parents: ['0badcafe'], occurrence: 0 };

const fitAnchor = { tag: 'table', textHash: 'deadbeef', occurrence: 0 };

const colEntry = (leftPercent: number) => ({
  anchor: { tag: 'div', textHash: 'deadbeef', occurrence: 0 },
  leftPercent,
});

const imgEntry = (widthPercent: number) => ({
  anchor: { kind: 'img', key: '/a.png', occurrence: 0 },
  widthPercent,
});

describe('parseLayout', () => {
  test('accepts a valid layout and recomputes paper dimensions from size', () => {
    const r = parseLayout({
      ...valid,
      page: { ...valid.page, size: 'B5', widthMm: 999, heightMm: 1 },
    });
    expect(r.layout?.page).toMatchObject({ widthMm: 182, heightMm: 257 });
    expect(r.warnings).toEqual([]);
  });

  test('out-of-range margin resets page to defaults with a warning', () => {
    const r = parseLayout({
      ...valid,
      page: {
        ...valid.page,
        margin: { top: 51, bottom: 15, left: 20, right: 20 },
      },
    });
    expect(r.layout?.page.margin).toEqual({
      top: 15,
      bottom: 15,
      left: 20,
      right: 20,
    });
    expect(r.warnings.length).toBe(1);
  });

  test('invalid page resets only the page, keeping other fields', () => {
    const r = parseLayout({
      ...valid,
      page: { ...valid.page, size: 'A0', orientation: 'landscape' },
    });
    expect(r.layout?.page).toEqual(defaultLayout('', '').page);
    expect(r.layout?.breaks).toEqual(valid.breaks);
    expect(r.warnings.length).toBe(1);
  });

  test('drops image entries with widthPercent 4 or 101 and keeps valid ones', () => {
    const r = parseLayout({
      ...valid,
      images: [imgEntry(4), imgEntry(50), imgEntry(101)],
    });
    expect(r.layout?.images).toEqual([imgEntry(50)]);
    expect(r.warnings.length).toBe(2);
  });

  test('drops a break whose tag contains markup like "img onerror"', () => {
    const r = parseLayout({
      ...valid,
      breaks: [
        { anchor: { tag: 'img onerror', textHash: 'deadbeef', occurrence: 0 } },
        valid.breaks[0],
      ],
    });
    expect(r.layout?.breaks).toEqual(valid.breaks);
    expect(r.warnings.length).toBe(1);
  });

  test('drops entries with a bad textHash, occurrence, key, or kind', () => {
    const r = parseLayout({
      ...valid,
      breaks: [
        { anchor: { tag: 'p', textHash: 'DEADBEEF', occurrence: 0 } },
        { anchor: { tag: 'p', textHash: 'deadbeef', occurrence: 10000 } },
        { anchor: { tag: 'p', textHash: 'deadbeef', occurrence: 1.5 } },
      ],
      images: [
        { anchor: { kind: 'img', key: '', occurrence: 0 }, widthPercent: 50 },
        {
          anchor: { kind: 'img', key: 'x'.repeat(2049), occurrence: 0 },
          widthPercent: 50,
        },
        { anchor: { kind: 'svg', key: 'x', occurrence: 0 }, widthPercent: 50 },
      ],
    });
    expect(r.layout?.breaks).toEqual([]);
    expect(r.layout?.images).toEqual([]);
    expect(r.warnings.length).toBe(6);
  });

  test('caps breaks at 1000 entries', () => {
    const breaks = Array.from({ length: 1001 }, (_, i) => ({
      anchor: { tag: 'p', textHash: 'deadbeef', occurrence: i % 10 },
    }));
    const r = parseLayout({ ...valid, breaks });
    expect(r.layout?.breaks.length).toBe(1000);
    expect(r.warnings.length).toBe(1);
  });

  test('strips unknown keys including a "css" string', () => {
    const r = parseLayout({
      ...valid,
      css: 'body{background:url(//evil)}',
      breaks: [{ ...valid.breaks[0], css: 'x' }],
    });
    expect(r.layout).not.toHaveProperty('css');
    expect(r.layout?.breaks[0]).toEqual(valid.breaks[0]);
  });

  test('a layout saved without columns reads them as an empty list', () => {
    const { columns: _omitted, ...withoutColumns } = valid;
    const r = parseLayout(withoutColumns);
    expect(r.layout?.columns).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  test('drops columns with leftPercent 9, 91 or 50.5 and keeps valid integers in 10..90', () => {
    const r = parseLayout({
      ...valid,
      columns: [colEntry(9), colEntry(30), colEntry(91), colEntry(50.5), colEntry(33)],
    });
    expect(r.layout?.columns).toEqual([colEntry(30), colEntry(33)]);
    expect(r.warnings.length).toBe(3);
  });

  test('drops a column whose anchor is invalid', () => {
    const r = parseLayout({
      ...valid,
      columns: [{ anchor: { tag: 'div x', textHash: 'deadbeef', occurrence: 0 }, leftPercent: 30 }],
    });
    expect(r.layout?.columns).toEqual([]);
    expect(r.warnings.length).toBe(1);
  });

  test('caps columns at 1000 entries', () => {
    const columns = Array.from({ length: 1001 }, () => colEntry(40));
    const r = parseLayout({ ...valid, columns });
    expect(r.layout?.columns.length).toBe(1000);
    expect(r.warnings.length).toBe(1);
  });

  test('a layout saved without fits reads them as an empty list without a warning', () => {
    const { fits: _omitted, ...withoutFits } = valid;
    const r = parseLayout(withoutFits);
    expect(r.layout?.fits).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  test('drops fits with an unknown mode, a bad scale or a bad anchor and keeps the valid ones', () => {
    const good = { anchor: fitAnchor, mode: 'scale', scalePercent: 50 };
    const r = parseLayout({
      ...valid,
      fits: [
        { anchor: fitAnchor, mode: 'zoom' },
        { anchor: fitAnchor, mode: 'scale', scalePercent: 30 },
        { anchor: fitAnchor, mode: 'scale', scalePercent: 101 },
        { anchor: fitAnchor, mode: 'scale', scalePercent: 72.5 },
        { anchor: fitAnchor, mode: 'scale' },
        { anchor: fitAnchor, mode: 'scale', scalePercent: '70' },
        { mode: 'shrink' },
        { anchor: { ...fitAnchor, tag: 'table x' }, mode: 'shrink' },
        good,
        { anchor: fitAnchor, mode: 'scale', scalePercent: 100 },
      ],
    });
    expect(r.layout?.fits).toEqual([good, { anchor: fitAnchor, mode: 'scale', scalePercent: 100 }]);
    expect(r.warnings.length).toBe(8);
  });

  test('a scalePercent on a shrink entry is ignored and the entry stays shrink', () => {
    const r = parseLayout({ ...valid, fits: [{ anchor: fitAnchor, mode: 'shrink', scalePercent: 30 }] });
    expect(r.layout?.fits).toEqual([{ anchor: fitAnchor, mode: 'shrink' }]);
    expect(r.warnings).toEqual([]);
  });

  test('caps fits at 1000 entries', () => {
    const fits = Array.from({ length: 1001 }, () => ({ anchor: fitAnchor, mode: 'shrink' }));
    const r = parseLayout({ ...valid, fits });
    expect(r.layout?.fits.length).toBe(1000);
    expect(r.warnings.length).toBe(1);
  });

  test('a layout saved without hidden reads it as an empty list without a warning', () => {
    const { hidden: _omitted, ...withoutHidden } = valid;
    const r = parseLayout(withoutHidden);
    expect(r.layout?.hidden).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  test('drops hidden entries with a bad anchor, parents, label or occurrence and keeps the valid ones', () => {
    const good = { anchor: hiddenAnchor, label: '2章' };
    const r = parseLayout({
      ...valid,
      hidden: [
        { label: 'no anchor' },
        { anchor: { tag: 'h2', textHash: 'deadbeef', occurrence: 0 }, label: 'no parents' },
        { anchor: { ...hiddenAnchor, parents: '0badcafe' }, label: 'parents not a list' },
        { anchor: { ...hiddenAnchor, parents: [1] }, label: 'parent not a string' },
        { anchor: { ...hiddenAnchor, parents: ['not-hash'] }, label: 'parent not a hash' },
        { anchor: { ...hiddenAnchor, parents: Array.from({ length: 6 }, () => '0badcafe') }, label: 'six parents' },
        { anchor: hiddenAnchor, label: 42 },
        { anchor: hiddenAnchor },
        { anchor: { ...hiddenAnchor, occurrence: -1 }, label: 'negative' },
        { anchor: { ...hiddenAnchor, occurrence: 0.5 }, label: 'fraction' },
        good,
        { anchor: { ...hiddenAnchor, parents: Array.from({ length: 5 }, () => '0badcafe') }, label: '' },
      ],
    });
    expect(r.layout?.hidden).toEqual([
      good,
      { anchor: { ...hiddenAnchor, parents: Array.from({ length: 5 }, () => '0badcafe') }, label: '' },
    ]);
    expect(r.warnings.length).toBe(10);
  });

  test('a label over 100 characters is cut to 100 without a warning', () => {
    const r = parseLayout({ ...valid, hidden: [{ anchor: hiddenAnchor, label: 'あ'.repeat(150) }] });
    expect(r.layout?.hidden).toEqual([{ anchor: hiddenAnchor, label: 'あ'.repeat(100) }]);
    expect(r.warnings).toEqual([]);
  });

  test('unknown keys in a hidden entry are stripped', () => {
    const r = parseLayout({
      ...valid,
      hidden: [{ anchor: { ...hiddenAnchor, css: 'x' }, label: 'a', css: 'x' }],
    });
    expect(r.layout?.hidden).toEqual([{ anchor: hiddenAnchor, label: 'a' }]);
  });

  test('caps hidden at 1000 entries and counts the rest as dropped', () => {
    const hidden = Array.from({ length: 1001 }, (_, i) => ({ anchor: { ...hiddenAnchor, occurrence: i }, label: 'x' }));
    const r = parseLayout({ ...valid, hidden });
    expect(r.layout?.hidden.length).toBe(1000);
    expect(r.warnings.length).toBe(1);
    expect(r.droppedHidden).toBe(1);
  });

  test('counts hidden entries it could not read', () => {
    const good = { anchor: hiddenAnchor, label: '2章' };
    expect(parseLayout({ ...valid, hidden: [good, { anchor: hiddenAnchor, label: 42 }, 'x'] }).droppedHidden).toBe(2);
    expect(parseLayout({ ...valid, hidden: 'not a list' }).droppedHidden).toBe(1);
    expect(parseLayout({ ...valid, hidden: [good] }).droppedHidden).toBe(0);
    const { hidden: _omitted, ...withoutHidden } = valid;
    expect(parseLayout(withoutHidden).droppedHidden).toBe(0);
  });

  test('identical hidden entries are kept once and are not counted as dropped', () => {
    const r = parseLayout({
      ...valid,
      hidden: [
        { anchor: hiddenAnchor, label: 'a' },
        { anchor: { ...hiddenAnchor }, label: 'a (copy)' },
        { anchor: { ...hiddenAnchor, occurrence: 1 }, label: 'b' },
      ],
    });
    expect(r.layout?.hidden.map((h) => h.label)).toEqual(['a', 'b']);
    expect(r.droppedHidden).toBe(0);
  });

  test('a valid layout with columns round-trips unchanged', () => {
    const r = parseLayout(JSON.parse(JSON.stringify(valid)));
    expect(r.layout).toEqual(valid);
    expect(r.warnings).toEqual([]);
  });

  test('returns null layout for version 2, for a string, and for null', () => {
    for (const input of [{ ...valid, version: 2 }, 'text', null]) {
      const r = parseLayout(input);
      expect(r.layout).toBeNull();
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });
});
