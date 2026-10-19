/** GROWI's page grant values that the plugin distinguishes. */
export const PAGE_GRANT = { public: 1, linkOnly: 2, ownerOnly: 4, group: 5 } as const;

/** A group a page is granted to; `type` is GROWI's group model name ('UserGroup' / 'ExternalUserGroup'). */
export interface GrantedGroup {
  type: string;
  id: string;
}

export interface PageRecord {
  id: string;
  path: string;
  revisionId: string;
  body: string;
  grant: number;
  grantedGroups: GrantedGroup[];
}

export class ConflictError extends Error {
  constructor(message = 'The page was updated by someone else') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class PermissionError extends Error {
  constructor(message = 'Not permitted to access or save the page') {
    super(message);
    this.name = 'PermissionError';
  }
}

/** Nothing was written: the child page cannot get the source page's grant. */
export class GrantRejectedError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`元ページと同じ閲覧権限で保存できません（保存先: ${path}）`);
    this.name = 'GrantRejectedError';
    this.path = path;
  }
}

/** The page exists but its grant is wider than (or differs from) the source page's. */
export class GrantMismatchError extends Error {
  readonly path: string;
  /** The saved child record, so the caller can keep editing without a stale revisionId. */
  readonly page: PageRecord;

  constructor(page: PageRecord) {
    super(
      `元ページと同じ閲覧権限で保存できませんでした。子ページ ${page.path} の権限を確認してください`,
    );
    this.name = 'GrantMismatchError';
    this.path = page.path;
    this.page = page;
  }
}

const API_BASE = '/_api/v3';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function request(method: string, url: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
  const init: RequestInit = { method, credentials: 'same-origin', headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new Error(`Network error while calling ${method} ${url}: ${String(error)}`);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`Unexpected non-JSON response (HTTP ${response.status})`);
  }
}

function throwForStatus(response: Response, context: string): never {
  if (response.status === 401 || response.status === 403) {
    throw new PermissionError(`${context}: HTTP ${response.status}`);
  }
  if (response.status === 409) {
    throw new ConflictError(`${context}: HTTP 409`);
  }
  throw new Error(`${context}: HTTP ${response.status}`);
}

function groupOf(entry: unknown): GrantedGroup {
  if (isRecord(entry) && typeof entry.type === 'string') {
    const { item, type } = entry;
    if (typeof item === 'string') return { type, id: item };
    if (isRecord(item) && typeof item._id === 'string') return { type, id: item._id };
  }
  throw new Error('Unexpected grantedGroups entry in page response');
}

/**
 * `page.revision` is a populated object on GET but only an id string on POST/PUT, where the
 * revision object is returned beside `page` instead.
 */
function toPageRecord(page: unknown, topLevelRevision: unknown): PageRecord {
  if (!isRecord(page)) throw new Error('Unexpected page response shape');
  const revision = isRecord(page.revision) ? page.revision : topLevelRevision;
  if (
    typeof page._id !== 'string' ||
    typeof page.path !== 'string' ||
    typeof page.grant !== 'number' ||
    !isRecord(revision) ||
    typeof revision._id !== 'string' ||
    typeof revision.body !== 'string'
  ) {
    throw new Error('Unexpected page response shape');
  }
  const groups = page.grantedGroups ?? [];
  if (!Array.isArray(groups)) throw new Error('Unexpected grantedGroups in page response');
  return {
    id: page._id,
    path: page.path,
    revisionId: revision._id,
    body: revision.body,
    grant: page.grant,
    grantedGroups: groups.map(groupOf),
  };
}

async function parseRecord(response: Response): Promise<PageRecord> {
  const json = await readJson(response);
  if (!isRecord(json)) throw new Error('Unexpected page response shape');
  return toPageRecord(json.page, json.revision);
}

async function fetchPage(query: string): Promise<PageRecord | null> {
  const response = await request('GET', `${API_BASE}/page?${query}`);
  if (response.status === 404) return null;
  if (!response.ok) throwForStatus(response, 'Fetching the page');
  return parseRecord(response);
}

export function fetchPageById(pageId: string): Promise<PageRecord | null> {
  const id = pageId.replace(/^\//, '');
  return fetchPage(`pageId=${encodeURIComponent(id)}`);
}

export function fetchPageByPath(path: string): Promise<PageRecord | null> {
  return fetchPage(`path=${encodeURIComponent(path)}`);
}

const pageExistsAt = async (path: string): Promise<boolean> => {
  try {
    return (await fetchPageByPath(path)) != null;
  } catch {
    return false;
  }
};

export type GrantSpec = Pick<PageRecord, 'grant' | 'grantedGroups'>;

/** Without these fields GROWI would take the grant (and groups) of the closest ancestor instead. */
function grantFields({ grant, grantedGroups }: GrantSpec): JsonRecord {
  if (grant !== PAGE_GRANT.group) return { grant };
  return { grant, grantUserGroupIds: grantedGroups.map(({ type, id }) => ({ type, item: id })) };
}

export async function createPage(path: string, body: string, grant: GrantSpec): Promise<PageRecord> {
  const response = await request('POST', `${API_BASE}/page`, { path, body, ...grantFields(grant) });
  if (!response.ok) {
    const { status } = response;
    if (status === 409) throw new ConflictError('Creating the page: HTTP 409');
    if (status >= 500) throw new Error(`Creating the page: HTTP ${status}`);
    if (status === 401 || status === 403) throw new PermissionError(`Creating the page: HTTP ${status}`);
    // GROWI 8.0.4 rejects a create on an existing path with HTTP 400, not 409.
    if (await pageExistsAt(path)) {
      throw new ConflictError(`Creating the page: HTTP ${status}, the page already exists`);
    }
    // Otherwise it refused the grant itself ("not assignable to this page").
    throw new GrantRejectedError(path);
  }
  return parseRecord(response);
}

export async function updatePage(
  pageId: string,
  revisionId: string,
  body: string,
): Promise<PageRecord> {
  const response = await request('PUT', `${API_BASE}/page`, { pageId, revisionId, body });
  if (!response.ok) throwForStatus(response, 'Updating the page');
  return parseRecord(response);
}

export async function isLoggedIn(): Promise<boolean> {
  try {
    const response = await request('GET', `${API_BASE}/personal-setting`);
    return response.ok;
  } catch {
    return false;
  }
}
