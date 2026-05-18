import type { Pool, PoolClient } from 'pg';
import type {
  FilterQuery,
  SortArg,
  NormalizedField,
  DbRow,
  QueryOptions,
} from '../types.js';
import type { Schema } from '../schema.js';
import { Document } from '../document.js';
import { buildWhere } from './filter.js';
import { buildSelectClause } from './select.js';

export class Query<T = Record<string, unknown>> implements PromiseLike<T[]> {
  #pool: Pool;
  #schema: Schema<T>;
  #tableName: string;
  #filter: FilterQuery;

  #sortArg?: SortArg;
  #limitVal?: number;
  #skipVal?: number;
  #selectArg?: string | Record<string, 0 | 1>;
  #leanFlag = false;
  #session?: PoolClient;

  constructor(
    pool: Pool,
    schema: Schema<T>,
    tableName: string,
    filter: FilterQuery = {}
  ) {
    this.#pool = pool;
    this.#schema = schema;
    this.#tableName = tableName;
    this.#filter = filter;
  }

  sort(arg: SortArg): this {
    this.#sortArg = arg;
    return this;
  }

  limit(n: number): this {
    this.#limitVal = n;
    return this;
  }

  skip(n: number): this {
    this.#skipVal = n;
    return this;
  }

  select(arg: string | Record<string, 0 | 1>): this {
    this.#selectArg = arg;
    return this;
  }

  lean(): this {
    this.#leanFlag = true;
    return this;
  }

  session(client: PoolClient): this {
    this.#session = client;
    return this;
  }

  async exec(): Promise<T[]> {
    const db = this.#session ?? this.#pool;
    const { sql: whereSql, params } = buildWhere(this.#filter, this.#schema.fields);

    const selectCols = buildSelectClause(this.#selectArg);
    const orderBy = buildOrderBy(this.#sortArg);
    const limit = this.#limitVal !== undefined ? ` LIMIT ${this.#limitVal}` : '';
    const offset = this.#skipVal !== undefined ? ` OFFSET ${this.#skipVal}` : '';

    const query = `SELECT ${selectCols} FROM "${this.#tableName}" WHERE ${whereSql}${orderBy}${limit}${offset}`;
    const result = await db.query(query, params);

    return result.rows.map((row: DbRow) => this.#rowToResult(row) as T);
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  #rowToResult(row: DbRow): Document<T> | (T & { _id: string }) {
    if (this.#leanFlag) {
      return {
        _id: row._id,
        ...(row.data ?? {}),
        ...(row.created_at !== undefined ? { created_at: row.created_at } : {}),
        ...(row.updated_at !== undefined ? { updated_at: row.updated_at } : {}),
      } as T & { _id: string };
    }
    const doc = new Document<T>(this.#schema, this.#tableName, row.data ?? {}, false, row._id);
    if (row.created_at) doc.created_at = row.created_at;
    if (row.updated_at) doc.updated_at = row.updated_at;
    return doc as Document<T>;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildOrderBy(sortArg?: SortArg): string {
  if (!sortArg) return '';
  const parts: string[] = [];

  if (typeof sortArg === 'string') {
    for (const token of sortArg.split(/\s+/)) {
      if (!token) continue;
      const desc = token.startsWith('-');
      const field = desc ? token.slice(1) : token;
      parts.push(sortFieldExpr(field, desc ? 'DESC' : 'ASC'));
    }
  } else {
    for (const [field, dir] of Object.entries(sortArg)) {
      const desc = dir === -1 || dir === 'desc';
      parts.push(sortFieldExpr(field, desc ? 'DESC' : 'ASC'));
    }
  }

  return parts.length > 0 ? ` ORDER BY ${parts.join(', ')}` : '';
}

function sortFieldExpr(field: string, dir: 'ASC' | 'DESC'): string {
  if (field === '_id') return `_id ${dir}`;
  if (field === 'created_at' || field === 'updated_at') return `${field} ${dir}`;
  return `data->>'${field}' ${dir}`;
}
