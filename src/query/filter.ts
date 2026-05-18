import type { FilterQuery, FilterOperators, SqlFragment, NormalizedField } from '../types.js';
import { jsonbExtract, pgCastForType } from '../utils/cast.js';
import { validateFieldName } from '../utils/validate.js';
import { isValidId } from '../utils/uuid.js';

/**
 * Translates a MongoDB-style filter object into a PostgreSQL WHERE clause.
 *
 * Returns { sql, params, nextParamIndex } where sql is the full WHERE expression
 * (without the WHERE keyword) and params are the positional $n values.
 */
export function buildWhere(
  filter: FilterQuery,
  fields: Map<string, NormalizedField>,
  startIndex = 1
): SqlFragment {
  const params: unknown[] = [];
  let idx = startIndex;

  function next(val: unknown): string {
    params.push(val);
    return `$${idx++}`;
  }

  function translateFilter(f: FilterQuery): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(f)) {
      if (key === '$and') {
        const exprs = (value as FilterQuery[]).map(translateFilter);
        parts.push(`(${exprs.join(' AND ')})`);
      } else if (key === '$or') {
        const exprs = (value as FilterQuery[]).map(translateFilter);
        parts.push(`(${exprs.join(' OR ')})`);
      } else if (key === '$nor') {
        const exprs = (value as FilterQuery[]).map(translateFilter);
        parts.push(`NOT (${exprs.join(' OR ')})`);
      } else {
        parts.push(translateFieldCondition(key, value, fields.get(key)));
      }
    }

    return parts.length === 0 ? 'TRUE' : parts.join(' AND ');
  }

  function translateFieldCondition(
    field: string,
    value: unknown,
    fieldDef: NormalizedField | undefined
  ): string {
    // _id lives as a top-level column, not in data
    if (field === '_id') {
      if (value === null) return '_id IS NULL';
      if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof RegExp) && !(value instanceof Date)) {
        return translateOperators('_id', value as FilterOperators, undefined, true);
      }
      // Reject structurally invalid UUIDs immediately (mirrors Mongoose returning null for bad ObjectId)
      if (typeof value === 'string' && !isValidId(value)) return 'FALSE';
      const p = next(value);
      return `_id = ${p}`;
    }

    validateFieldName(field);

    if (value === null || value === undefined) {
      return `(NOT data ? '${field}' OR data->>'${field}' IS NULL)`;
    }

    if (value instanceof RegExp) {
      const flags = value.flags;
      const op = flags.includes('i') ? '~*' : '~';
      const extract = `data->>'${field}'`;
      const p = next(value.source);
      return `${extract} ${op} ${p}`;
    }

    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const ops = value as FilterOperators;
      // Check if it has any operator keys
      const hasOps = Object.keys(ops).some(k => k.startsWith('$'));
      if (hasOps) {
        return translateOperators(field, ops, fieldDef);
      }
    }

    // Plain value: for arrays, check containment; otherwise equality
    if (Array.isArray(value)) {
      const p = next(JSON.stringify(value));
      return `data->'${field}' @> ${p}::jsonb`;
    }

    // Scalar equality — type-aware
    const extract = jsonbExtract(field, fieldDef?.type);
    const type = fieldDef?.type;
    if (type === Number) {
      const p = next(Number(value));
      return `${extract} = ${p}`;
    }
    if (type === Boolean) {
      const p = next(Boolean(value));
      return `${extract} = ${p}`;
    }
    if (type === Date) {
      const p = next(value instanceof Date ? value : new Date(value as string));
      return `${extract} = ${p}`;
    }
    const p = next(String(value));
    return `${extract} = ${p}`;
  }

  function translateOperators(
    field: string,
    ops: FilterOperators,
    fieldDef: NormalizedField | undefined,
    isTopLevel = false
  ): string {
    const parts: string[] = [];
    const extract = isTopLevel ? field : jsonbExtract(field, fieldDef?.type);
    const type = fieldDef?.type;

    for (const [op, opVal] of Object.entries(ops)) {
      switch (op) {
        case '$eq': {
          if (opVal === null) {
            parts.push(isTopLevel ? `${field} IS NULL` : `(NOT data ? '${field}' OR data->>'${field}' IS NULL)`);
          } else {
            const p = next(castScalar(opVal, type));
            parts.push(`${extract} = ${p}`);
          }
          break;
        }
        case '$ne': {
          if (opVal === null) {
            parts.push(isTopLevel ? `${field} IS NOT NULL` : `(data ? '${field}' AND data->>'${field}' IS NOT NULL)`);
          } else {
            const p = next(castScalar(opVal, type));
            parts.push(`${extract} <> ${p}`);
          }
          break;
        }
        case '$gt': {
          const p = next(castScalar(opVal, type));
          parts.push(`${extract} > ${p}`);
          break;
        }
        case '$gte': {
          const p = next(castScalar(opVal, type));
          parts.push(`${extract} >= ${p}`);
          break;
        }
        case '$lt': {
          const p = next(castScalar(opVal, type));
          parts.push(`${extract} < ${p}`);
          break;
        }
        case '$lte': {
          const p = next(castScalar(opVal, type));
          parts.push(`${extract} <= ${p}`);
          break;
        }
        case '$in': {
          const arr = opVal as unknown[];
          if (arr.length === 0) {
            parts.push('FALSE');
          } else {
            const casted = arr.map(v => castScalar(v, type));
            const p = next(casted);
            if (type === Number) {
              parts.push(`${extract} = ANY(${p}::numeric[])`);
            } else if (type === Boolean) {
              parts.push(`${extract} = ANY(${p}::boolean[])`);
            } else {
              parts.push(`data->>'${field}' = ANY(${p}::text[])`);
            }
          }
          break;
        }
        case '$nin': {
          const arr = opVal as unknown[];
          if (arr.length === 0) {
            parts.push('TRUE');
          } else {
            const casted = arr.map(v => castScalar(v, type));
            const p = next(casted);
            if (type === Number) {
              parts.push(`NOT (${extract} = ANY(${p}::numeric[]))`);
            } else if (type === Boolean) {
              parts.push(`NOT (${extract} = ANY(${p}::boolean[]))`);
            } else {
              parts.push(`NOT (data->>'${field}' = ANY(${p}::text[]))`);
            }
          }
          break;
        }
        case '$exists': {
          if (isTopLevel) break;
          if (opVal) {
            parts.push(`data ? '${field}'`);
          } else {
            parts.push(`NOT data ? '${field}'`);
          }
          break;
        }
        case '$not': {
          const inner = translateOperators(field, opVal as FilterOperators, fieldDef, isTopLevel);
          parts.push(`NOT (${inner})`);
          break;
        }
        case '$regex': {
          const flags = (ops as FilterOperators).$options ?? '';
          const op = flags.includes('i') ? '~*' : '~';
          const src = opVal instanceof RegExp ? opVal.source : String(opVal);
          const p = next(src);
          const rawExtract = isTopLevel ? field : `data->>'${field}'`;
          parts.push(`${rawExtract} ${op} ${p}`);
          break;
        }
        case '$options':
          // consumed by $regex handler above
          break;
        case '$all': {
          const arr = opVal as unknown[];
          const p = next(JSON.stringify(arr));
          parts.push(`data->'${field}' @> ${p}::jsonb`);
          break;
        }
        case '$size': {
          const p = next(opVal as number);
          parts.push(`jsonb_array_length(data->'${field}') = ${p}`);
          break;
        }
        case '$elemMatch': {
          // Translate the inner filter applied against each element using jsonb_array_elements
          const innerFilter = opVal as FilterQuery;
          const innerParts: string[] = [];
          for (const [subKey, subVal] of Object.entries(innerFilter)) {
            validateFieldName(subKey);
            const subField = `elem->>'${subKey}'`;
            if (subVal !== null && typeof subVal === 'object' && !Array.isArray(subVal) && !(subVal instanceof Date)) {
              for (const [subOp, subOpVal] of Object.entries(subVal as FilterOperators)) {
                const cast = pgCastForType(fieldDef?.type);
                const subExtract = cast ? `(elem->'${subKey}')${cast}` : subField;
                const p = next(subOpVal);
                if (subOp === '$gt') innerParts.push(`${subExtract} > ${p}`);
                else if (subOp === '$gte') innerParts.push(`${subExtract} >= ${p}`);
                else if (subOp === '$lt') innerParts.push(`${subExtract} < ${p}`);
                else if (subOp === '$lte') innerParts.push(`${subExtract} <= ${p}`);
                else if (subOp === '$eq') innerParts.push(`${subExtract} = ${p}`);
                else if (subOp === '$ne') innerParts.push(`${subExtract} <> ${p}`);
              }
            } else {
              const p = next(subVal === null ? null : String(subVal));
              innerParts.push(`${subField} = ${p}`);
            }
          }
          const innerSql = innerParts.join(' AND ');
          parts.push(
            `EXISTS (SELECT 1 FROM jsonb_array_elements(data->'${field}') AS elem WHERE ${innerSql})`
          );
          break;
        }
        case '$type': {
          const jsonbType = mongoTypeToJsonbType(opVal as string);
          if (jsonbType) {
            parts.push(`jsonb_typeof(data->'${field}') = '${jsonbType}'`);
          }
          break;
        }
      }
    }

    return parts.length === 0 ? 'TRUE' : parts.join(' AND ');
  }

  const sql = Object.keys(filter).length === 0 ? 'TRUE' : translateFilter(filter);

  return { sql, params, nextParamIndex: idx };
}

function castScalar(value: unknown, type: NormalizedField['type'] | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (type === Number) return Number(value);
  if (type === Boolean) return Boolean(value);
  if (type === Date) {
    if (value instanceof Date) return value;
    return new Date(value as string);
  }
  return value;
}

function mongoTypeToJsonbType(mongoType: string): string | null {
  const map: Record<string, string> = {
    string: 'string',
    number: 'number',
    double: 'number',
    int: 'number',
    long: 'number',
    decimal: 'number',
    bool: 'boolean',
    boolean: 'boolean',
    array: 'array',
    object: 'object',
    null: 'null',
  };
  return map[mongoType.toLowerCase()] ?? null;
}
