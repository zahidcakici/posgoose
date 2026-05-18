import type { SchemaFieldType, NormalizedField } from '../types.js';

/** Returns the PostgreSQL cast expression suffix for a given schema field type */
export function pgCastForType(type: SchemaFieldType | undefined): string {
  if (!type) return '';
  if (type === Number) return '::numeric';
  if (type === Boolean) return '::boolean';
  if (type === Date) return '::timestamptz';
  return '';
}

/** Builds the SQL expression to extract a field value from the JSONB data column */
export function jsonbExtract(field: string, type: SchemaFieldType | undefined): string {
  const parts = field.split('.');
  if (parts.length === 1) {
    const cast = pgCastForType(type);
    if (cast) {
      return `(data->'${parts[0]}')${cast}`;
    }
    return `data->>'${parts[0]}'`;
  }
  // Nested: data->'a'->'b'->>'c'
  const last = parts[parts.length - 1];
  const middle = parts.slice(0, -1).map(p => `'${p}'`).join('->');
  const cast = pgCastForType(type);
  if (cast) {
    return `(data->${middle}->'${last}')${cast}`;
  }
  return `data->${middle}->>'${last}'`;
}

/** Builds the JSONB path array literal for jsonb_set, e.g. '{a,b,c}' */
export function jsonbPath(field: string): string {
  const parts = field.split('.');
  return `'{${parts.join(',')}}'`;
}

/** Casts a JS value to the correct type for parameterised SQL */
export function castValue(
  value: unknown,
  field: NormalizedField | undefined
): unknown {
  if (value === null || value === undefined) return null;
  if (!field) return value;

  const type = field.type;
  if (type === Number) return Number(value);
  if (type === Boolean) return Boolean(value);
  if (type === String) {
    let v = String(value);
    if (field.trim) v = v.trim();
    if (field.lowercase) v = v.toLowerCase();
    if (field.uppercase) v = v.toUpperCase();
    return v;
  }
  if (type === Date) {
    if (value instanceof Date) return value;
    return new Date(value as string);
  }
  return value;
}
