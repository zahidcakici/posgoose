import type { PoolClient } from 'pg';
import type { Schema } from './schema.js';
import { getPool } from './connection.js';
import { buildUpdate } from './query/update.js';
import { generateId } from './utils/uuid.js';

export class Document<T = Record<string, unknown>> {
  _id: string;
  isNew: boolean;

  readonly #schema: Schema<T>;
  readonly #tableName: string;
  #data: Record<string, unknown>;
  #original: Record<string, unknown>;
  #modifiedPaths: Set<string> = new Set();
  #session: PoolClient | null = null;

  created_at?: Date;
  updated_at?: Date;

  constructor(
    schema: Schema<T>,
    tableName: string,
    data: Record<string, unknown>,
    isNew = true,
    id?: string
  ) {
    this.#schema = schema;
    this.#tableName = tableName;
    this._id = id ?? generateId();
    this.isNew = isNew;
    this.#data = { ...data };
    this.#original = { ...data };
    return this.#buildProxy();
  }

  #buildProxy(): this {
    return new Proxy(this, {
      get(target, prop: string | symbol) {
        // Always resolve the value from the real target first
        const val = Reflect.get(target, prop, target);
        // Bind functions to target so private fields remain accessible
        if (typeof val === 'function') return (val as Function).bind(target);

        const str = typeof prop === 'string' ? prop : null;
        if (
          str &&
          !str.startsWith('_') &&
          !str.startsWith('#') &&
          str !== 'isNew' &&
          str !== 'created_at' &&
          str !== 'updated_at' &&
          str in target.#data
        ) {
          return target.#data[str];
        }
        return val;
      },
      set(target, prop: string | symbol, value) {
        const str = typeof prop === 'string' ? prop : null;
        if (
          str &&
          !str.startsWith('_') &&
          !str.startsWith('#') &&
          str !== 'isNew' &&
          str !== 'created_at' &&
          str !== 'updated_at' &&
          !(str in target)
        ) {
          target.#data[str] = value;
          target.#modifiedPaths.add(str);
          return true;
        }
        (target as Record<string | symbol, unknown>)[prop] = value;
        return true;
      },
    });
  }

  get(path: string): unknown {
    if (path === '_id') return this._id;
    const parts = path.split('.');
    let cur: unknown = this.#data;
    for (const part of parts) {
      if (cur === null || cur === undefined) return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }

  set(path: string, value: unknown): this {
    const parts = path.split('.');
    if (parts.length === 1) {
      this.#data[path] = value;
      this.#modifiedPaths.add(path);
      return this;
    }
    let cur = this.#data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) {
        cur[parts[i]] = {};
      }
      cur = cur[parts[i]] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
    this.#modifiedPaths.add(parts[0]);
    return this;
  }

  isModified(path?: string): boolean {
    if (path) return this.#modifiedPaths.has(path);
    return this.#modifiedPaths.size > 0;
  }

  markModified(path: string): void {
    this.#modifiedPaths.add(path);
  }

  $session(client: PoolClient): this {
    this.#session = client;
    return this;
  }

  validate(): void {
    this.#schema.validate(this.#data);
  }

  toObject(): T & { _id: string; created_at?: Date; updated_at?: Date } {
    return {
      _id: this._id,
      ...this.#data,
      ...(this.created_at !== undefined ? { created_at: this.created_at } : {}),
      ...(this.updated_at !== undefined ? { updated_at: this.updated_at } : {}),
    } as T & { _id: string; created_at?: Date; updated_at?: Date };
  }

  toJSON(): T & { _id: string; created_at?: Date; updated_at?: Date } {
    return this.toObject();
  }

  async save(): Promise<this> {
    const db = this.#session ?? getPool();
    const withTs = this.#schema.options.timestamps;
    const now = new Date();

    if (this.isNew) {
      this.#schema.validate(this.#data);
      const data = this.#schema.applyDefaults(this.#data);
      this.#data = data;

      const tsFields: Record<string, unknown> = {};
      if (withTs) {
        tsFields.created_at = now;
        tsFields.updated_at = now;
      }

      await db.query(
        `INSERT INTO "${this.#tableName}" (_id, data, created_at, updated_at)
         VALUES ($1::uuid, $2::jsonb, $3, $4)`,
        [
          this._id,
          JSON.stringify(this.#data),
          tsFields.created_at ?? null,
          tsFields.updated_at ?? null,
        ]
      );

      if (withTs) {
        this.created_at = now;
        this.updated_at = now;
      }
      this.isNew = false;
      this.#original = { ...this.#data };
      this.#modifiedPaths.clear();
      return this;
    }

    // Partial update — only modified top-level keys via $set
    if (this.#modifiedPaths.size === 0) return this;

    const patch: Record<string, unknown> = {};
    for (const path of this.#modifiedPaths) {
      patch[path] = this.#data[path];
    }

    const { dataExpr, params } = buildUpdate(
      { $set: patch },
      this.#schema.fields,
      2,
      false
    );

    let sql = `UPDATE "${this.#tableName}" SET data = ${dataExpr}`;
    const allParams: unknown[] = [this._id, ...params];

    if (withTs) {
      allParams.push(now);
      sql += `, updated_at = $${allParams.length}`;
    }

    sql += ` WHERE _id = $1`;
    await db.query(sql, allParams);

    if (withTs) this.updated_at = now;
    this.#original = { ...this.#data };
    this.#modifiedPaths.clear();
    return this;
  }

  async remove(): Promise<this> {
    const db = this.#session ?? getPool();
    await db.query(`DELETE FROM "${this.#tableName}" WHERE _id = $1`, [this._id]);
    return this;
  }

  /** Alias matching Mongoose 7+ API */
  deleteOne = this.remove.bind(this);
}
