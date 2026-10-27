/**
 * Minimal fetch wrapper for the Istari registry REST API.
 * Every request carries `Authorization: Bearer <token>`; non-2xx responses become GatewayError.
 */
import { GatewayError } from '../types';

export type QueryScalar = string | number | boolean;
export type QueryValue = QueryScalar | QueryScalar[] | null | undefined;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  query?: Query;
  /** JSON-serialised when provided. */
  body?: unknown;
}

export interface HttpClientOptions {
  registryUrl: string;
  getToken: () => string | null;
}

/** Offset-paginated v2 envelope. */
export interface OffsetPage<T> {
  items: T[];
  total?: number | null;
  page: number;
  size: number;
  pages?: number | null;
}

/** Cursor-paginated v3 envelope. */
export interface CursorPage<T> {
  items: T[];
  total?: number | null;
  next_page?: string | null;
  previous_page?: string | null;
}

export function appendQuery(url: URL, query: Query | undefined): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) url.searchParams.append(key, String(v));
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class HttpClient {
  private readonly apiBase: string;
  private readonly getToken: () => string | null;

  constructor(opts: HttpClientOptions) {
    this.apiBase = `${opts.registryUrl.replace(/\/+$/, '')}/registry/api`;
    this.getToken = opts.getToken;
  }

  /** Absolute URL for an API path such as `/v3/resources`. */
  url(path: string, query?: Query): URL {
    const url = new URL(`${this.apiBase}${path}`);
    appendQuery(url, query);
    return url;
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  post<T>(path: string, body: unknown, query?: Query): Promise<T> {
    return this.request<T>('POST', path, { query, body });
  }

  put<T>(path: string, body: unknown, query?: Query): Promise<T> {
    return this.request<T>('PUT', path, { query, body });
  }

  delete<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('DELETE', path, { query });
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const token = this.getToken();
    if (!token) throw new GatewayError('No Istari bearer token available', { status: 401 });
    const url = this.url(path, opts.query);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body });
    } catch (cause) {
      throw new GatewayError(`${method} ${path}: network error`, { cause });
    }
    const parsed = await parseBody(res);
    if (!res.ok) {
      throw new GatewayError(`${method} ${path} failed: HTTP ${res.status}`, {
        status: res.status,
        body: parsed,
      });
    }
    return parsed as T;
  }

  /** Walk every page of a v2 offset-paginated endpoint (page size 100). */
  async getAllPages<T>(path: string, query: Query = {}, maxPages = 50): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const res = await this.get<OffsetPage<T>>(path, { ...query, page, size: 100 });
      items.push(...res.items);
      const pages = res.pages ?? 1;
      if (page >= pages || res.items.length === 0) break;
    }
    return items;
  }

  /** Walk every page of a v3 cursor-paginated endpoint (page size 100). */
  async getAllCursorPages<T>(path: string, query: Query = {}, maxPages = 50): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | null | undefined;
    for (let i = 0; i < maxPages; i++) {
      const res = await this.get<CursorPage<T>>(path, { ...query, size: 100, include_total: false, cursor });
      items.push(...res.items);
      cursor = res.next_page;
      if (!cursor || res.items.length === 0) break;
    }
    return items;
  }
}
