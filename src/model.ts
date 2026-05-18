import type { PoolClient } from 'pg';
import type {
  FilterQuery,
  UpdateQuery,
  QueryOptions,
  DbRow,
} from './types.js';
import type { Schema } from './schema.js';
import { getPool } from './connection.js';
import { Document } from './document.js';
import { Query, buildOrderBy } from './query/builder.js';
import { buildWhere } from './query/filter.js';
import { buildUpdate } from './query/update.js';
import { buildSelectClause, buildReturningClause } from './query/select.js';
import { generateId } from './utils/uuid.js';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

type DocResult<T> = Document<T> & T;
type LeanResult<T> = T & { _id: string; created_at?: Date; updated_at?: Date };

function rowToLean<T>(row: DbRow): LeanResult<T> {
  return { _id: row._id, ...row.data, created_at: row.created_at ?? undefined, updated_at: row.updated_at ?? undefined } as LeanResult<T>;
}

function rowToDoc<T>(
  schema: Schema<T>,
  tableName: string,
  row: DbRow
): DocResult<T> {
  const doc = new Document<T>(schema, tableName, row.data, false, row._id);
  if (row.created_at) doc.created_at = row.created_at;
  if (row.updated_at) doc.updated_at = row.updated_at;
  return doc as DocResult<T>;
}

function dbFor(opts?: QueryOptions): ReturnType<typeof getPool> | PoolClient {
  return opts?.session ?? getPool();
}

// ---------------------------------------------------------------------------
// Model factory
// ---------------------------------------------------------------------------

export function createModel<T>(
  modelName: string,
  schema: Schema<T>
): ModelClass<T> {
  const tableName = schema.options.collection || modelName.toLowerCase() + 's';
  const withTs = schema.options.timestamps;

  // Ensure the table exists when the model is first used
  let tableReady: Promise<void> | null = null;

  async function ensureTable(): Promise<void> {
    if (tableReady) return tableReady;
    tableReady = (async () => {
      const pool = getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "${tableName}" (
          _id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          data        JSONB       NOT NULL DEFAULT '{}',
          created_at  TIMESTAMPTZ,
          updated_at  TIMESTAMPTZ
        )
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS "${tableName}_data_gin" ON "${tableName}" USING GIN (data)`
      );
      if (schema.options.autoIndex) {
        await syncIndexesImpl(pool);
      }
    })();
    return tableReady;
  }

  async function syncIndexesImpl(pool: ReturnType<typeof getPool>): Promise<void> {
    for (const [field, def] of schema.fields) {
      if (def.unique) {
        await pool.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS "${tableName}_${field}_unique"
           ON "${tableName}" ((data->>'${field}'))`
        );
      } else if (def.index) {
        await pool.query(
          `CREATE INDEX IF NOT EXISTS "${tableName}_${field}_idx"
           ON "${tableName}" ((data->>'${field}'))`
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The Model class
  // ---------------------------------------------------------------------------
  class Model {
    static modelName = modelName;
    static schema = schema;

    // ---- create ----
    static async create(
      docOrDocs: Partial<T> | Partial<T>[],
      opts?: { session?: PoolClient }
    ): Promise<DocResult<T> | DocResult<T>[]> {
      await ensureTable();
      const db = opts?.session ?? getPool();
      const isArray = Array.isArray(docOrDocs);
      const docs = isArray ? (docOrDocs as Partial<T>[]) : [docOrDocs as Partial<T>];

      // Validate all docs up-front before touching the DB
      for (const raw of docs) {
        schema.validate(raw as Record<string, unknown>);
      }

      const now = withTs ? new Date() : null;
      const values: unknown[] = [];
      const rowPlaceholders: string[] = [];
      let p = 1;

      for (const raw of docs) {
        const data = schema.applyDefaults(raw as Record<string, unknown>);
        const id = generateId();
        rowPlaceholders.push(`($${p++}::uuid, $${p++}::jsonb, $${p++}, $${p++})`);
        values.push(id, JSON.stringify(data), now, now);
      }

      const result = await db.query(
        `INSERT INTO "${tableName}" (_id, data, created_at, updated_at)
         VALUES ${rowPlaceholders.join(', ')} RETURNING *`,
        values
      );

      const results = result.rows.map((row) => rowToDoc<T>(schema, tableName, row as DbRow));
      return isArray ? results : results[0];
    }

    // ---- insertMany ----
    static async insertMany(
      docs: Partial<T>[],
      opts?: { session?: PoolClient }
    ): Promise<DocResult<T>[]> {
      const result = await Model.create(docs, opts);
      return result as DocResult<T>[];
    }

    // ---- find ----
    static find(
      filter: FilterQuery<T> = {},
      opts?: QueryOptions
    ): Query<T> {
      void ensureTable();
      const q = new Query<T>(getPool(), schema, tableName, filter as FilterQuery);
      if (opts?.sort) q.sort(opts.sort);
      if (opts?.limit !== undefined) q.limit(opts.limit);
      if (opts?.skip !== undefined) q.skip(opts.skip);
      if (opts?.select) q.select(opts.select);
      if (opts?.lean) q.lean();
      if (opts?.session) q.session(opts.session);
      return q;
    }

    // ---- findOne ----
    static async findOne(
      filter: FilterQuery<T> = {},
      opts?: QueryOptions
    ): Promise<DocResult<T> | LeanResult<T> | null> {
      await ensureTable();
      const db = dbFor(opts);
      const { sql, params } = buildWhere(filter as FilterQuery, schema.fields);
      const orderBy = buildOrderBy(opts?.sort);
      const selectCols = buildSelectClause(opts?.select);
      const result = await db.query(
        `SELECT ${selectCols} FROM "${tableName}" WHERE ${sql}${orderBy} LIMIT 1`,
        params
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0] as DbRow;
      return opts?.lean ? rowToLean<T>(row) : rowToDoc<T>(schema, tableName, row);
    }

    // ---- findById ----
    static async findById(
      id: string,
      opts?: QueryOptions
    ): Promise<DocResult<T> | LeanResult<T> | null> {
      return Model.findOne({ _id: id } as FilterQuery<T>, opts);
    }

    // ---- findByIdAndUpdate ----
    static async findByIdAndUpdate(
      id: string,
      update: UpdateQuery<T>,
      opts?: QueryOptions
    ): Promise<DocResult<T> | LeanResult<T> | null> {
      return Model.findOneAndUpdate({ _id: id } as FilterQuery<T>, update, opts);
    }

    // ---- findByIdAndDelete ----
    static async findByIdAndDelete(
      id: string,
      opts?: QueryOptions
    ): Promise<DocResult<T> | LeanResult<T> | null> {
      return Model.findOneAndDelete({ _id: id } as FilterQuery<T>, opts);
    }

    // ---- findOneAndUpdate ----
    static async findOneAndUpdate(
      filter: FilterQuery<T>,
      update: UpdateQuery<T>,
      opts?: QueryOptions
    ): Promise<DocResult<T> | LeanResult<T> | null> {
      await ensureTable();
      const db = dbFor(opts);
      const returnNew = opts?.new ?? false;
      const upsert = opts?.upsert ?? false;

      const { sql: whereSql, params: whereParams } = buildWhere(
        filter as FilterQuery,
        schema.fields
      );

      const { dataExpr, params: updateParams } = buildUpdate(
        update as UpdateQuery,
        schema.fields,
        whereParams.length + 1,
        withTs
      );

      const allParams = [...whereParams, ...updateParams];
      let tsClause = '';

      if (withTs) {
        allParams.push(new Date());
        tsClause = `, updated_at = $${allParams.length}`;
      }

      const returning = buildReturningClause(opts?.select);

      if (upsert) {
        // For upsert, try update first, then insert
        const updateResult = await db.query(
          `UPDATE "${tableName}" SET data = ${dataExpr}${tsClause}
           WHERE _id = (SELECT _id FROM "${tableName}" WHERE ${whereSql} LIMIT 1)
           ${returning}`,
          allParams
        );
        if (updateResult.rows.length > 0) {
          const row = updateResult.rows[0] as DbRow;
          return opts?.lean ? rowToLean<T>(row) : rowToDoc<T>(schema, tableName, row);
        }
        // Nothing matched — insert
        const raw = extractSetValues(update as UpdateQuery);
        const newDoc = await Model.create(raw as Partial<T>, { session: opts?.session });
        return newDoc as DocResult<T>;
      }

      const result = await db.query(
        `UPDATE "${tableName}" SET data = ${dataExpr}${tsClause}
         WHERE _id = (SELECT _id FROM "${tableName}" WHERE ${whereSql} LIMIT 1)
         ${returning}`,
        allParams
      );

      if (result.rows.length === 0) return null;
      const row = result.rows[0] as DbRow;
      return opts?.lean ? rowToLean<T>(row) : rowToDoc<T>(schema, tableName, row);
    }

    // ---- findOneAndDelete ----
    static async findOneAndDelete(
      filter: FilterQuery<T>,
      opts?: QueryOptions
    ): Promise<DocResult<T> | LeanResult<T> | null> {
      await ensureTable();
      const db = dbFor(opts);
      const { sql, params } = buildWhere(filter as FilterQuery, schema.fields);
      const returning = buildReturningClause(opts?.select);
      const result = await db.query(
        `DELETE FROM "${tableName}"
         WHERE _id = (SELECT _id FROM "${tableName}" WHERE ${sql} LIMIT 1)
         ${returning}`,
        params
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0] as DbRow;
      return opts?.lean ? rowToLean<T>(row) : rowToDoc<T>(schema, tableName, row);
    }

    // ---- updateOne ----
    static async updateOne(
      filter: FilterQuery<T>,
      update: UpdateQuery<T>,
      opts?: QueryOptions
    ): Promise<{ matchedCount: number; modifiedCount: number }> {
      await ensureTable();
      const db = dbFor(opts);
      const { sql: whereSql, params: whereParams } = buildWhere(
        filter as FilterQuery,
        schema.fields
      );
      const { dataExpr, params: updateParams } = buildUpdate(
        update as UpdateQuery,
        schema.fields,
        whereParams.length + 1,
        withTs
      );
      const allParams = [...whereParams, ...updateParams];
      let tsClause = '';
      if (withTs) {
        allParams.push(new Date());
        tsClause = `, updated_at = $${allParams.length}`;
      }
      const result = await db.query(
        `UPDATE "${tableName}" SET data = ${dataExpr}${tsClause}
         WHERE _id = (SELECT _id FROM "${tableName}" WHERE ${whereSql} LIMIT 1)`,
        allParams
      );
      return { matchedCount: result.rowCount ?? 0, modifiedCount: result.rowCount ?? 0 };
    }

    // ---- updateMany ----
    static async updateMany(
      filter: FilterQuery<T>,
      update: UpdateQuery<T>,
      opts?: QueryOptions
    ): Promise<{ matchedCount: number; modifiedCount: number }> {
      await ensureTable();
      const db = dbFor(opts);
      const { sql: whereSql, params: whereParams } = buildWhere(
        filter as FilterQuery,
        schema.fields
      );
      const { dataExpr, params: updateParams } = buildUpdate(
        update as UpdateQuery,
        schema.fields,
        whereParams.length + 1,
        withTs
      );
      const allParams = [...whereParams, ...updateParams];
      let tsClause = '';
      if (withTs) {
        allParams.push(new Date());
        tsClause = `, updated_at = $${allParams.length}`;
      }
      const result = await db.query(
        `UPDATE "${tableName}" SET data = ${dataExpr}${tsClause} WHERE ${whereSql}`,
        allParams
      );
      return { matchedCount: result.rowCount ?? 0, modifiedCount: result.rowCount ?? 0 };
    }

    // ---- deleteOne ----
    static async deleteOne(
      filter: FilterQuery<T>,
      opts?: QueryOptions
    ): Promise<{ deletedCount: number }> {
      await ensureTable();
      const db = dbFor(opts);
      const { sql, params } = buildWhere(filter as FilterQuery, schema.fields);
      const result = await db.query(
        `DELETE FROM "${tableName}"
         WHERE _id = (SELECT _id FROM "${tableName}" WHERE ${sql} LIMIT 1)`,
        params
      );
      return { deletedCount: result.rowCount ?? 0 };
    }

    // ---- deleteMany ----
    static async deleteMany(
      filter: FilterQuery<T> = {},
      opts?: QueryOptions
    ): Promise<{ deletedCount: number }> {
      await ensureTable();
      const db = dbFor(opts);
      const { sql, params } = buildWhere(filter as FilterQuery, schema.fields);
      const result = await db.query(
        `DELETE FROM "${tableName}" WHERE ${sql}`,
        params
      );
      return { deletedCount: result.rowCount ?? 0 };
    }

    // ---- countDocuments ----
    static async countDocuments(
      filter: FilterQuery<T> = {},
      opts?: QueryOptions
    ): Promise<number> {
      await ensureTable();
      const db = dbFor(opts);
      const { sql, params } = buildWhere(filter as FilterQuery, schema.fields);
      const result = await db.query(
        `SELECT COUNT(*) AS count FROM "${tableName}" WHERE ${sql}`,
        params
      );
      return parseInt((result.rows[0] as { count: string }).count, 10);
    }

    // ---- exists ----
    static async exists(
      filter: FilterQuery<T>,
      opts?: QueryOptions
    ): Promise<{ _id: string } | null> {
      await ensureTable();
      const db = dbFor(opts);
      const { sql, params } = buildWhere(filter as FilterQuery, schema.fields);
      const result = await db.query(
        `SELECT _id FROM "${tableName}" WHERE ${sql} LIMIT 1`,
        params
      );
      if (result.rows.length === 0) return null;
      return { _id: (result.rows[0] as { _id: string })._id };
    }

    // ---- syncIndexes ----
    static async syncIndexes(): Promise<void> {
      await ensureTable();
      await syncIndexesImpl(getPool());
    }

    // ---- dropTable (utility, not in Mongoose) ----
    static async dropTable(): Promise<void> {
      const pool = getPool();
      await pool.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
      tableReady = null;
    }
  }

  return Model as unknown as ModelClass<T>;
}

// ---------------------------------------------------------------------------
// Public type for a Model class
// ---------------------------------------------------------------------------

export interface ModelClass<T> {
  new(data?: Partial<T>): DocResult<T>;
  modelName: string;
  schema: Schema<T>;

  create(doc: Partial<T>, opts?: { session?: PoolClient }): Promise<DocResult<T>>;
  create(docs: Partial<T>[], opts?: { session?: PoolClient }): Promise<DocResult<T>[]>;
  insertMany(docs: Partial<T>[], opts?: { session?: PoolClient }): Promise<DocResult<T>[]>;

  find(filter?: FilterQuery<T>, opts?: QueryOptions): Query<T>;
  findOne(filter?: FilterQuery<T>, opts?: QueryOptions): Promise<DocResult<T> | LeanResult<T> | null>;
  findById(id: string, opts?: QueryOptions): Promise<DocResult<T> | LeanResult<T> | null>;
  findByIdAndUpdate(id: string, update: UpdateQuery<T>, opts?: QueryOptions): Promise<DocResult<T> | LeanResult<T> | null>;
  findByIdAndDelete(id: string, opts?: QueryOptions): Promise<DocResult<T> | LeanResult<T> | null>;
  findOneAndUpdate(filter: FilterQuery<T>, update: UpdateQuery<T>, opts?: QueryOptions): Promise<DocResult<T> | LeanResult<T> | null>;
  findOneAndDelete(filter: FilterQuery<T>, opts?: QueryOptions): Promise<DocResult<T> | LeanResult<T> | null>;
  updateOne(filter: FilterQuery<T>, update: UpdateQuery<T>, opts?: QueryOptions): Promise<{ matchedCount: number; modifiedCount: number }>;
  updateMany(filter: FilterQuery<T>, update: UpdateQuery<T>, opts?: QueryOptions): Promise<{ matchedCount: number; modifiedCount: number }>;
  deleteOne(filter: FilterQuery<T>, opts?: QueryOptions): Promise<{ deletedCount: number }>;
  deleteMany(filter?: FilterQuery<T>, opts?: QueryOptions): Promise<{ deletedCount: number }>;
  countDocuments(filter?: FilterQuery<T>, opts?: QueryOptions): Promise<number>;
  exists(filter: FilterQuery<T>, opts?: QueryOptions): Promise<{ _id: string } | null>;
  syncIndexes(): Promise<void>;
  dropTable(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helper: extract plain values from an update op (used for upsert inserts)
// ---------------------------------------------------------------------------

function extractSetValues(update: UpdateQuery): Record<string, unknown> {
  const ops = update as Record<string, Record<string, unknown>>;
  if (ops['$set']) return ops['$set'];
  // Direct replacement
  const copy = { ...(update as Record<string, unknown>) };
  delete copy['_id'];
  return copy;
}
