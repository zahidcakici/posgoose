import { validateFieldName } from '../utils/validate.js';

const META_COLS = new Set(['_id', 'created_at', 'updatedAt', 'created_at', 'updated_at']);

interface ParsedSelect {
  inclusions: string[];
  exclusions: string[];
  excludeId: boolean;
}

function parseSelectArg(select: string | Record<string, 0 | 1>): ParsedSelect {
  const inclusions: string[] = [];
  const exclusions: string[] = [];
  let excludeId = false;

  if (typeof select === 'string') {
    for (const token of select.split(/\s+/).filter(Boolean)) {
      if (token.startsWith('-')) {
        const f = token.slice(1);
        if (f === '_id') excludeId = true;
        else exclusions.push(f);
      } else if (token !== '_id') {
        inclusions.push(token);
      }
    }
  } else {
    for (const [field, val] of Object.entries(select)) {
      if (field === '_id') {
        if (val === 0) excludeId = true;
      } else if (val === 1) {
        inclusions.push(field);
      } else if (val === 0) {
        exclusions.push(field);
      }
    }
  }

  return { inclusions, exclusions, excludeId };
}

/**
 * Returns the SQL expression for the `data` column given a select argument.
 * Returns null when no projection is needed (select *).
 *
 * Validated field names are interpolated; values are never interpolated.
 */
export function buildDataProjectionExpr(
  select?: string | Record<string, 0 | 1>
): string | null {
  if (!select) return null;

  const { inclusions, exclusions } = parseSelectArg(select);

  // Inclusion projection: jsonb_build_object('a', data->'a', 'b', data->'b')
  if (inclusions.length > 0) {
    // For nested paths like 'address.city', include the full top-level key
    const topLevel = [...new Set(inclusions.map(f => {
      validateFieldName(f);
      return f.split('.')[0];
    }))];
    const pairs = topLevel.map(f => `'${f}', data->'${f}'`).join(', ');
    return `jsonb_build_object(${pairs})`;
  }

  // Exclusion projection: data - ARRAY['a','b']::text[]
  if (exclusions.length > 0) {
    // For nested paths like 'address.city', only the top-level key is excluded
    // (full nested exclusion requires more complex JSONB path ops)
    const topLevel = [...new Set(exclusions.map(f => {
      validateFieldName(f);
      return f.split('.')[0];
    }))];
    const arr = topLevel.map(f => `'${f}'`).join(', ');
    return `data - ARRAY[${arr}]::text[]`;
  }

  return null;
}

/**
 * Builds the column list for a SELECT statement.
 * Example outputs:
 *   - no select  → '*'
 *   - inclusion  → '_id, created_at, updated_at, jsonb_build_object(...) AS data'
 *   - exclusion  → '_id, created_at, updated_at, data - ARRAY[...] AS data'
 */
export function buildSelectClause(select?: string | Record<string, 0 | 1>): string {
  if (!select) return '*';
  const { excludeId } = parseSelectArg(select);
  const proj = buildDataProjectionExpr(select);
  const idCol = excludeId ? '' : '_id, ';
  if (!proj) return excludeId ? 'created_at, updated_at, data' : '*';
  return `${idCol}created_at, updated_at, ${proj} AS data`;
}

/**
 * Builds the RETURNING clause for UPDATE/DELETE statements.
 */
export function buildReturningClause(select?: string | Record<string, 0 | 1>): string {
  if (!select) return 'RETURNING *';
  const { excludeId } = parseSelectArg(select);
  const proj = buildDataProjectionExpr(select);
  const idCol = excludeId ? '' : '_id, ';
  if (!proj) return excludeId ? 'RETURNING created_at, updated_at, data' : 'RETURNING *';
  return `RETURNING ${idCol}created_at, updated_at, ${proj} AS data`;
}
