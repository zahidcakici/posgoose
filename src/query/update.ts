import type { UpdateQuery, SqlFragment, NormalizedField } from '../types.js';
import { jsonbPath } from '../utils/cast.js';
import { validateFieldName } from '../utils/validate.js';

/**
 * Translates a MongoDB-style update object into a PostgreSQL SET clause fragment.
 *
 * Returns { sql, params, nextParamIndex } where sql is the expression for the
 * SET data = <expr> part (only the right-hand side expression, not "SET data =").
 *
 * Also returns separate sets for created_at / updated_at if needed.
 */
export interface UpdateFragment {
  dataExpr: string;
  params: unknown[];
  nextParamIndex: number;
  setCreatedAt?: boolean;
  setUpdatedAt?: boolean;
}

export function buildUpdate(
  update: UpdateQuery,
  _fields: Map<string, NormalizedField>,
  startIndex = 1,
  withTimestamps = false
): UpdateFragment {
  const params: unknown[] = [];
  let idx = startIndex;

  function next(val: unknown): string {
    params.push(val);
    return `$${idx++}`;
  }

  // Check if any key starts with '$' — if not, it's a full document replacement
  const keys = Object.keys(update);
  const isOperatorUpdate = keys.some(k => k.startsWith('$'));

  if (!isOperatorUpdate) {
    // Full replacement: strip _id if present, replace data entirely
    const replacement = { ...update } as Record<string, unknown>;
    delete replacement['_id'];
    const p = next(JSON.stringify(replacement));
    return {
      dataExpr: `${p}::jsonb`,
      params,
      nextParamIndex: idx,
      setUpdatedAt: withTimestamps,
    };
  }

  const ops = update as Record<string, Record<string, unknown>>;
  // Start building the chain of jsonb operations on top of `data`
  let expr = 'data';

  // --- $unset (remove keys) ---
  if (ops['$unset']) {
    for (const field of Object.keys(ops['$unset'])) {
      validateFieldName(field);
      const parts = field.split('.');
      if (parts.length === 1) {
        expr = `(${expr} - '${field}')`;
      } else {
        const pathLiteral = `'{${parts.join(',')}}'::text[]`;
        expr = `(${expr} #- ${pathLiteral})`;
      }
    }
  }

  // --- $rename ---
  if (ops['$rename']) {
    for (const [oldKey, newKey] of Object.entries(ops['$rename'])) {
      validateFieldName(oldKey);
      validateFieldName(newKey as string);
      const newPath = jsonbPath(newKey as string);
      expr = `(jsonb_set(${expr} - '${oldKey}', ${newPath}, (${expr}->'${oldKey}')))`;
    }
  }

  // --- $set ---
  if (ops['$set']) {
    for (const [field, value] of Object.entries(ops['$set'])) {
      validateFieldName(field);
      const path = jsonbPath(field);
      const p = next(toJsonbLiteral(value));
      expr = `jsonb_set(${expr}, ${path}, ${p}::jsonb)`;
    }
  }

  // --- $inc ---
  if (ops['$inc']) {
    for (const [field, delta] of Object.entries(ops['$inc'])) {
      validateFieldName(field);
      const path = jsonbPath(field);
      const fieldAccess = buildJsonbAccess(field);
      const d = next(Number(delta));
      expr = `jsonb_set(${expr}, ${path}, to_jsonb(coalesce((${fieldAccess})::numeric, 0) + ${d}))`;
    }
  }

  // --- $mul ---
  if (ops['$mul']) {
    for (const [field, factor] of Object.entries(ops['$mul'])) {
      validateFieldName(field);
      const path = jsonbPath(field);
      const fieldAccess = buildJsonbAccess(field);
      const f = next(Number(factor));
      expr = `jsonb_set(${expr}, ${path}, to_jsonb(coalesce((${fieldAccess})::numeric, 0) * ${f}))`;
    }
  }

  // --- $min ---
  if (ops['$min']) {
    for (const [field, minVal] of Object.entries(ops['$min'])) {
      validateFieldName(field);
      const path = jsonbPath(field);
      const fieldAccess = buildJsonbAccess(field);
      const p = next(toJsonbLiteral(minVal));
      expr = `jsonb_set(${expr}, ${path}, CASE WHEN (${fieldAccess})::numeric <= (${p}::jsonb)::numeric THEN (${expr}->'${field}') ELSE ${p}::jsonb END)`;
    }
  }

  // --- $max ---
  if (ops['$max']) {
    for (const [field, maxVal] of Object.entries(ops['$max'])) {
      validateFieldName(field);
      const path = jsonbPath(field);
      const fieldAccess = buildJsonbAccess(field);
      const p = next(toJsonbLiteral(maxVal));
      expr = `jsonb_set(${expr}, ${path}, CASE WHEN (${fieldAccess})::numeric >= (${p}::jsonb)::numeric THEN (${expr}->'${field}') ELSE ${p}::jsonb END)`;
    }
  }

  // --- $push ---
  if (ops['$push']) {
    for (const [field, value] of Object.entries(ops['$push'])) {
      validateFieldName(field);
      const path = jsonbPath(field);
      const p = next(toJsonbLiteral(value));
      expr = `jsonb_set(${expr}, ${path}, coalesce(${expr}->'${field}','[]'::jsonb) || to_jsonb(${p}::jsonb))`;
    }
  }

  // --- $addToSet ---
  if (ops['$addToSet']) {
    for (const [field, value] of Object.entries(ops['$addToSet'])) {
      validateFieldName(field);
      const path = jsonbPath(field);
      const p = next(toJsonbLiteral(value));
      expr = `jsonb_set(${expr}, ${path}, CASE WHEN coalesce(${expr}->'${field}','[]'::jsonb) @> to_jsonb(${p}::jsonb) THEN coalesce(${expr}->'${field}','[]'::jsonb) ELSE coalesce(${expr}->'${field}','[]'::jsonb) || to_jsonb(${p}::jsonb) END)`;
    }
  }

  // --- $pull ---
  if (ops['$pull']) {
    for (const [field, condition] of Object.entries(ops['$pull'])) {
      validateFieldName(field);
      const path = jsonbPath(field);
      if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
        // Object condition — filter array elements that don't match
        const condParts: string[] = [];
        for (const [k, v] of Object.entries(condition as Record<string, unknown>)) {
          validateFieldName(k);
          const p = next(String(v));
          condParts.push(`(elem->>'${k}') <> ${p}`);
        }
        const condSql = condParts.join(' AND ');
        expr = `jsonb_set(${expr}, ${path}, COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements(${expr}->'${field}') AS elem WHERE ${condSql}),'[]'::jsonb))`;
      } else {
        // Scalar condition
        const p = next(toJsonbLiteral(condition));
        expr = `jsonb_set(${expr}, ${path}, COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements(${expr}->'${field}') AS elem WHERE elem <> ${p}::jsonb),'[]'::jsonb))`;
      }
    }
  }

  // --- $pop ---
  // Note: arithmetic `-` has higher PostgreSQL precedence than `->`,
  // so `data->'arr' - n` parses as `data -> ('arr' - n)`. We must
  // parenthesise the extraction: `(data->'arr') - n`.
  if (ops['$pop']) {
    for (const [field, direction] of Object.entries(ops['$pop'])) {
      validateFieldName(field);
      const path = jsonbPath(field);
      const arr = `(${expr}->'${field}')`;
      if (Number(direction) === 1) {
        // remove last element
        expr = `jsonb_set(${expr}, ${path}, CASE WHEN jsonb_array_length(${arr}) > 0 THEN (${arr} - (jsonb_array_length(${arr}) - 1)) ELSE '[]'::jsonb END)`;
      } else {
        // remove first element
        expr = `jsonb_set(${expr}, ${path}, CASE WHEN jsonb_array_length(${arr}) > 0 THEN (${arr} - 0) ELSE '[]'::jsonb END)`;
      }
    }
  }

  return {
    dataExpr: expr,
    params,
    nextParamIndex: idx,
    setUpdatedAt: withTimestamps,
  };
}

/** Converts a JS value to a JSON string suitable for ::jsonb cast */
function toJsonbLiteral(value: unknown): string {
  return JSON.stringify(value);
}

/** Returns the data->>'field' accessor for a given dot-notation field */
function buildJsonbAccess(field: string): string {
  const parts = field.split('.');
  if (parts.length === 1) return `data->>'${field}'`;
  const last = parts[parts.length - 1];
  const middle = parts.slice(0, -1).map(p => `'${p}'`).join('->');
  return `data->${middle}->>'${last}'`;
}
