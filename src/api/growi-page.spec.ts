import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  ConflictError,
  createPage,
  fetchPageById,
  fetchPageByPath,
  GrantRejectedError,
  isLoggedIn,
  PermissionError,
  updatePage,
} from './growi-page';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Shapes observed on GROWI 8.0.4: GET populates page.revision, POST/PUT return it beside page.
const getBody = {
  page: {
    _id: 'p1',
    path: '/a/_print-layout',
    grant: 5,
    grantedGroups: [{ type: 'UserGroup', item: { _id: 'g1', name: 'grp' }, _id: 'x' }],
    revision: { _id: 'r1', body: 'hello' },
  },
};
const writeBody = {
  page: { _id: 'p1', path: '/a/_print-layout', grant: 1, grantedGroups: [], revision: 'r2' },
  revision: { _id: 'r2', body: 'new' },
};

const stubFetch = (response: Response | Error) => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/** Answers each call with the next item; an Error item is thrown as a network failure. */
const stubFetchSequence = (responses: (Response | Error)[]) => {
  let call = 0;
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const response = responses[call];
    call += 1;
    if (response === undefined) throw new Error('unexpected extra fetch call');
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const PUBLIC = { grant: 1, grantedGroups: [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('page fetching', () => {
  test('fetchPageById strips a leading slash, encodes the id and parses the record', async () => {
    const fetchMock = stubFetch(json(200, getBody));
    const record = await fetchPageById('/p 1');
    expect(fetchMock.mock.calls[0]).toEqual([
      '/_api/v3/page?pageId=p%201',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest' }),
      }),
    ]);
    expect(record).toEqual({
      id: 'p1',
      path: '/a/_print-layout',
      revisionId: 'r1',
      body: 'hello',
      grant: 5,
      grantedGroups: [{ type: 'UserGroup', id: 'g1' }],
    });
  });

  test('fetchPageByPath encodes the path and returns null on 404', async () => {
    const fetchMock = stubFetch(json(404, { errors: [{ code: 'page-not-found' }] }));
    expect(await fetchPageByPath('/日本 語/x')).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe(`/_api/v3/page?path=${encodeURIComponent('/日本 語/x')}`);
  });

  test('groups are read with their type from both string and object items', async () => {
    const body = {
      page: {
        ...getBody.page,
        grantedGroups: [{ type: 'UserGroup', item: 'g1' }, { type: 'ExternalUserGroup', item: { _id: 'g2' } }],
      },
    };
    stubFetch(json(200, body));
    expect((await fetchPageById('p1'))?.grantedGroups).toEqual([
      { type: 'UserGroup', id: 'g1' },
      { type: 'ExternalUserGroup', id: 'g2' },
    ]);
  });

  test('a group entry without a type is an unexpected shape', async () => {
    stubFetch(json(200, { page: { ...getBody.page, grantedGroups: [{ item: 'g1' }] } }));
    await expect(fetchPageById('p1')).rejects.toThrow(/Unexpected grantedGroups entry/);
  });

  test('401/403 map to PermissionError', async () => {
    stubFetch(json(403, {}));
    await expect(fetchPageById('p1')).rejects.toBeInstanceOf(PermissionError);
    stubFetch(json(401, {}));
    await expect(fetchPageByPath('/a')).rejects.toBeInstanceOf(PermissionError);
  });

  test('network errors, non-JSON and unexpected shapes throw plain Errors', async () => {
    stubFetch(new TypeError('offline'));
    await expect(fetchPageById('p1')).rejects.toThrow(/Network error/);
    stubFetch(new Response('<html>', { status: 200 }));
    await expect(fetchPageById('p1')).rejects.toThrow(/non-JSON/);
    stubFetch(json(200, { page: { _id: 'p1' } }));
    await expect(fetchPageById('p1')).rejects.toThrow(/Unexpected page response shape/);
    stubFetch(json(500, {}));
    await expect(fetchPageById('p1')).rejects.toThrow(/HTTP 500/);
  });
});

describe('page writing', () => {
  test('createPage posts path, body and the given grant, and sends X-Requested-With', async () => {
    const fetchMock = stubFetch(json(201, writeBody));
    const record = await createPage('/a/_print-layout', 'new', PUBLIC);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/_api/v3/page');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Requested-With': 'XMLHttpRequest' });
    expect(JSON.parse(init.body as string)).toEqual({ path: '/a/_print-layout', body: 'new', grant: 1 });
    expect(record.revisionId).toBe('r2');
    expect(record.body).toBe('new');
  });

  test('createPage sends a group grant with every group as a { type, item } pair', async () => {
    const fetchMock = stubFetch(json(201, writeBody));
    await createPage('/a/_print-layout', 'new', {
      grant: 5,
      grantedGroups: [
        { type: 'UserGroup', id: 'g1' },
        { type: 'ExternalUserGroup', id: 'e1' },
      ],
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      path: '/a/_print-layout',
      body: 'new',
      grant: 5,
      grantUserGroupIds: [
        { type: 'UserGroup', item: 'g1' },
        { type: 'ExternalUserGroup', item: 'e1' },
      ],
    });
  });

  test('createPage sends owner-only and link-only grants without groups', async () => {
    for (const grant of [2, 4]) {
      const fetchMock = stubFetch(json(201, writeBody));
      await createPage('/a/_print-layout', 'new', { grant, grantedGroups: [] });
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ path: '/a/_print-layout', body: 'new', grant });
    }
  });

  test('createPage maps 409 to ConflictError and 401/403/5xx without re-checking the path', async () => {
    for (const status of [401, 403]) {
      const fetchMock = stubFetch(json(status, {}));
      await expect(createPage('/a/_print-layout', 'x', PUBLIC)).rejects.toBeInstanceOf(PermissionError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    const conflict = stubFetch(json(409, {}));
    await expect(createPage('/a/_print-layout', 'x', PUBLIC)).rejects.toBeInstanceOf(ConflictError);
    expect(conflict).toHaveBeenCalledTimes(1);
    const serverError = stubFetch(json(500, {}));
    const error = await createPage('/a/_print-layout', 'x', PUBLIC).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermissionError);
    expect(error).not.toBeInstanceOf(ConflictError);
    expect(serverError).toHaveBeenCalledTimes(1);
  });

  // GROWI 8.0.4 answers a create on an existing path with HTTP 400 "Cannot process create".
  test('createPage turns a 4xx into ConflictError when the path now holds a page', async () => {
    const fetchMock = stubFetchSequence([json(400, { errors: [{ message: 'Cannot process create' }] }), json(200, getBody)]);

    await expect(createPage('/a/_print-layout', 'x', PUBLIC)).rejects.toBeInstanceOf(ConflictError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/_api/v3/page?path=%2Fa%2F_print-layout');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'GET' });
  });

  // GROWI 8.0.4 answers a grant it will not assign with HTTP 400 "The selected grant or
  // grantedGroup is not assignable to this page."
  test('createPage turns a 4xx into GrantRejectedError when the path is still free or the re-check fails', async () => {
    const notAssignable = { errors: [{ message: 'The selected grant or grantedGroup is not assignable to this page.' }] };
    for (const recheck of [json(404, {}), new TypeError('offline'), json(500, {})]) {
      stubFetchSequence([json(400, notAssignable), recheck]);
      const error = await createPage('/a/_print-layout', 'x', PUBLIC).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GrantRejectedError);
      expect((error as GrantRejectedError).message).toContain('元ページと同じ閲覧権限で保存できません');
      expect((error as GrantRejectedError).message).toContain('/a/_print-layout');
      expect((error as GrantRejectedError).path).toBe('/a/_print-layout');
    }
  });

  test('createPage surfaces network errors as a plain Error', async () => {
    stubFetch(new TypeError('offline'));
    await expect(createPage('/a/_print-layout', 'x', PUBLIC)).rejects.toThrow(/Network error/);
  });

  test('updatePage sends pageId, revisionId and body', async () => {
    const fetchMock = stubFetch(json(201, writeBody));
    await updatePage('p1', 'r1', 'new');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ pageId: 'p1', revisionId: 'r1', body: 'new' });
  });

  test('updatePage maps 409 to ConflictError and 403 to PermissionError', async () => {
    stubFetch(json(409, { errors: [{ code: 'conflict' }] }));
    await expect(updatePage('p1', 'r1', 'x')).rejects.toBeInstanceOf(ConflictError);
    stubFetch(json(403, {}));
    await expect(updatePage('p1', 'r1', 'x')).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('isLoggedIn', () => {
  test('isLoggedIn is false on 401/403 and network failure, true on 200', async () => {
    stubFetch(json(200, {}));
    expect(await isLoggedIn()).toBe(true);
    stubFetch(json(401, {}));
    expect(await isLoggedIn()).toBe(false);
    stubFetch(json(403, {}));
    expect(await isLoggedIn()).toBe(false);
    stubFetch(new TypeError('offline'));
    expect(await isLoggedIn()).toBe(false);
  });
});
