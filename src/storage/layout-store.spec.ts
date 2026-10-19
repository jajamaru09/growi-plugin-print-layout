import { afterEach, describe, expect, test, vi } from 'vitest';

import { ConflictError, GrantMismatchError, GrantRejectedError, PermissionError, type PageRecord } from '../api/growi-page';
import { defaultLayout, serializeLayoutPage } from '../layout';
import { layoutPagePath, loadLayout, saveLayout } from './layout-store';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const pageJson = (over: { grant?: number; groups?: string[]; body?: string; rev?: string }) => ({
  _id: 'child1',
  path: '/a/_print-layout',
  grant: over.grant ?? 1,
  grantedGroups: (over.groups ?? []).map((id) => ({ type: 'UserGroup', item: { _id: id } })),
  revision: { _id: over.rev ?? 'r1', body: over.body ?? '' },
});

const userGroup = (id: string) => ({ type: 'UserGroup', id });

const source: PageRecord = {
  id: 'src1',
  path: '/a',
  revisionId: 'sr1',
  body: '# a',
  grant: 1,
  grantedGroups: [],
};
const layout = defaultLayout('src1', 'sr1');

type Handler = (url: string, init: RequestInit) => Response;
const routeFetch = (handler: Handler) => {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('layoutPagePath', () => {
  test('layoutPagePath: "/" -> "/_print-layout", "/a/b" -> "/a/b/_print-layout", "/a/b/" -> "/a/b/_print-layout"', () => {
    expect(layoutPagePath('/')).toBe('/_print-layout');
    expect(layoutPagePath('/a/b')).toBe('/a/b/_print-layout');
    expect(layoutPagePath('/a/b/')).toBe('/a/b/_print-layout');
  });
});

describe('loadLayout', () => {
  test('loadLayout with no child page returns layout null, no warnings', async () => {
    const fetchMock = routeFetch(() => json(404, { errors: [{ code: 'page-not-found' }] }));
    expect(await loadLayout(source)).toEqual({ layout: null, warnings: [], layoutPage: null, droppedHidden: 0 });
    expect(fetchMock.mock.calls[0][0]).toBe(`/_api/v3/page?path=${encodeURIComponent('/a/_print-layout')}`);
  });

  test('loadLayout with a corrupted child page returns layout null plus a warning, not a throw', async () => {
    routeFetch(() => json(200, { page: pageJson({ body: 'edited by hand' }) }));
    const result = await loadLayout(source);
    expect(result.layout).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.layoutPage?.id).toBe('child1');
  });

  test('loadLayout returns the saved layout from a valid child page', async () => {
    routeFetch(() => json(200, { page: pageJson({ body: serializeLayoutPage(layout) }) }));
    const result = await loadLayout(source);
    expect(result.layout).toEqual(layout);
    expect(result.layoutPage?.revisionId).toBe('r1');
    expect(result.droppedHidden).toBe(0);
  });

  test('loadLayout reports how many saved hides it could not read', async () => {
    const body = serializeLayoutPage({ ...layout, hidden: [] }).replace(/"hidden": \[\]/, '"hidden": [{ "label": "x" }]');
    expect(body).toContain('"hidden": [{ "label": "x" }]');
    routeFetch(() => json(200, { page: pageJson({ body }) }));
    expect((await loadLayout(source)).droppedHidden).toBe(1);
  });
});

describe('saveLayout', () => {
  test('saveLayout creates the child at the layout path when none exists', async () => {
    const fetchMock = routeFetch((_url, init) =>
      init.method === 'POST'
        ? json(201, {
            page: { ...pageJson({}), revision: 'r1' },
            revision: { _id: 'r1', body: 'b' },
          })
        : json(200, { page: pageJson({}) }),
    );
    const saved = await saveLayout(source, layout, null);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      path: '/a/_print-layout',
      body: serializeLayoutPage(layout),
      grant: 1,
    });
    expect(saved.id).toBe('child1');
  });

  test('saveLayout creates the child with the source page grant and groups', async () => {
    const groupSource: PageRecord = { ...source, grant: 5, grantedGroups: [userGroup('g1')] };
    const fetchMock = routeFetch((_url, init) =>
      init.method === 'POST'
        ? json(201, { page: { ...pageJson({ grant: 5, groups: ['g1'] }), revision: 'r1' }, revision: { _id: 'r1', body: 'b' } })
        : json(200, { page: pageJson({ grant: 5, groups: ['g1'] }) }),
    );
    await saveLayout(groupSource, layout, null);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toMatchObject({ grant: 5, grantUserGroupIds: [{ type: 'UserGroup', item: 'g1' }] });
  });

  test('saveLayout surfaces GrantRejectedError when GROWI will not assign the grant on create', async () => {
    routeFetch((_url, init) => (init.method === 'POST' ? json(400, {}) : json(404, {})));
    await expect(saveLayout(source, layout, null)).rejects.toBeInstanceOf(GrantRejectedError);
  });

  test('saveLayout updates with the existing revisionId; on ConflictError it rethrows without retrying', async () => {
    const existing: PageRecord = { ...source, id: 'child1', path: '/a/_print-layout', revisionId: 'old' };
    const fetchMock = routeFetch((_url, init) =>
      init.method === 'PUT' ? json(409, { errors: [{ code: 'conflict' }] }) : json(200, { page: pageJson({ rev: 'newer' }) }),
    );
    await expect(saveLayout(source, layout, existing)).rejects.toBeInstanceOf(ConflictError);
    const puts = fetchMock.mock.calls.filter(([, init]) => init.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0][1].body as string)).toMatchObject({ pageId: 'child1', revisionId: 'old' });
  });

  test('saveLayout refuses to update a child whose grant differs from the source, writing nothing', async () => {
    const groupSource: PageRecord = { ...source, grant: 5, grantedGroups: [userGroup('g1')] };
    for (const child of [{ grant: 1 }, { grant: 4 }, { grant: 5, groups: ['g1', 'g2'] }, { grant: 5, groups: ['g2'] }]) {
      const existing: PageRecord = {
        ...source,
        id: 'child1',
        path: '/a/_print-layout',
        revisionId: 'r1',
        grant: child.grant,
        grantedGroups: (child.groups ?? []).map(userGroup),
      };
      const fetchMock = routeFetch(() => json(200, { page: pageJson(child) }));
      const error = await saveLayout(groupSource, layout, existing).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GrantRejectedError);
      expect((error as GrantRejectedError).path).toBe('/a/_print-layout');
      expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
    }
  });

  test('saveLayout checks the child grant as it is now, not as it was when the editor opened', async () => {
    const existing: PageRecord = { ...source, id: 'child1', path: '/a/_print-layout', revisionId: 'r1' };
    const fetchMock = routeFetch(() => json(200, { page: pageJson({ grant: 4 }) }));
    await expect(saveLayout(source, layout, existing)).rejects.toBeInstanceOf(GrantRejectedError);
    expect(fetchMock.mock.calls.some(([, init]) => init.method === 'PUT')).toBe(false);
  });

  test('saveLayout updates a child whose grant matches the source', async () => {
    const existing: PageRecord = { ...source, id: 'child1', path: '/a/_print-layout', revisionId: 'r1' };
    const fetchMock = routeFetch((_url, init) =>
      init.method === 'PUT'
        ? json(200, { page: { ...pageJson({}), revision: 'r2' }, revision: { _id: 'r2', body: 'b' } })
        : json(200, { page: pageJson({}) }),
    );
    const saved = await saveLayout(source, layout, existing);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(1);
    expect(saved.id).toBe('child1');
  });

  test('saveLayout surfaces PermissionError when creation is rejected', async () => {
    routeFetch(() => json(403, {}));
    await expect(saveLayout(source, layout, null)).rejects.toBeInstanceOf(PermissionError);
  });

  test('saveLayout throws GrantMismatchError when the created child is public under a group-only source', async () => {
    const groupSource: PageRecord = { ...source, grant: 5, grantedGroups: [userGroup('g1')] };
    routeFetch((_url, init) =>
      init.method === 'POST'
        ? json(201, { page: { ...pageJson({ grant: 1 }), revision: 'r1' }, revision: { _id: 'r1', body: 'b' } })
        : json(200, { page: pageJson({ grant: 1 }) }),
    );
    const error = await saveLayout(groupSource, layout, null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GrantMismatchError);
    expect((error as GrantMismatchError).path).toBe('/a/_print-layout');
  });

  test('saveLayout also rejects a narrower but different grant', async () => {
    routeFetch((_url, init) =>
      init.method === 'POST'
        ? json(201, { page: { ...pageJson({ grant: 4 }), revision: 'r1' }, revision: { _id: 'r1', body: 'b' } })
        : json(200, { page: pageJson({ grant: 4 }) }),
    );
    await expect(saveLayout(source, layout, null)).rejects.toBeInstanceOf(GrantMismatchError);
  });

  test('saveLayout accepts a group-only child that inherited the source groups', async () => {
    const groupSource: PageRecord = { ...source, grant: 5, grantedGroups: [userGroup('g1')] };
    routeFetch((_url, init) =>
      init.method === 'POST'
        ? json(201, { page: { ...pageJson({ grant: 5, groups: ['g1'] }), revision: 'r1' }, revision: { _id: 'r1', body: 'b' } })
        : json(200, { page: pageJson({ grant: 5, groups: ['g1'] }) }),
    );
    const saved = await saveLayout(groupSource, layout, null);
    expect(saved.grantedGroups).toEqual([userGroup('g1')]);
  });

  test('GrantMismatchError exposes the saved child record with its new revisionId', async () => {
    const groupSource: PageRecord = { ...source, grant: 5, grantedGroups: [userGroup('g1')] };
    routeFetch((_url, init) =>
      init.method === 'POST'
        ? json(201, { page: { ...pageJson({ grant: 1 }), revision: 'rNew' }, revision: { _id: 'rNew', body: 'b' } })
        : json(200, { page: pageJson({ grant: 1, rev: 'rNew', body: 'b' }) }),
    );
    const error = (await saveLayout(groupSource, layout, null).catch((e: unknown) => e)) as GrantMismatchError;
    expect(error).toBeInstanceOf(GrantMismatchError);
    expect(error.page).toMatchObject({ id: 'child1', revisionId: 'rNew', grant: 1 });
  });

  test('saveLayout falls back to the write response when the re-fetch fails', async () => {
    const groupSource: PageRecord = { ...source, grant: 5, grantedGroups: [userGroup('g1')] };
    const writeResponse = () =>
      json(201, {
        page: { ...pageJson({ grant: 5, groups: ['g1'] }), revision: 'rNew' },
        revision: { _id: 'rNew', body: 'b' },
      });
    routeFetch((_url, init) => (init.method === 'POST' ? writeResponse() : json(500, {})));
    const saved = await saveLayout(groupSource, layout, null);
    expect(saved.revisionId).toBe('rNew');

    routeFetch((_url, init) =>
      init.method === 'POST'
        ? json(201, { page: { ...pageJson({ grant: 1 }), revision: 'rNew' }, revision: { _id: 'rNew', body: 'b' } })
        : json(500, {}),
    );
    const error = (await saveLayout(groupSource, layout, null).catch((e: unknown) => e)) as GrantMismatchError;
    expect(error).toBeInstanceOf(GrantMismatchError);
    expect(error.page.revisionId).toBe('rNew');
  });

  test('saveLayout treats a narrower group set as a mismatch', async () => {
    const groupSource: PageRecord = { ...source, grant: 5, grantedGroups: [userGroup('g1'), userGroup('g2')] };
    routeFetch((_url, init) =>
      init.method === 'POST'
        ? json(201, { page: { ...pageJson({ grant: 5, groups: ['g1'] }), revision: 'r1' }, revision: { _id: 'r1', body: 'b' } })
        : json(200, { page: pageJson({ grant: 5, groups: ['g1'] }) }),
    );
    await expect(saveLayout(groupSource, layout, null)).rejects.toBeInstanceOf(GrantMismatchError);
  });
});
