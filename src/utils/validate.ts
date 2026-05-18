/**
 * Validates a field name before it is interpolated into a SQL string.
 * Field names come from filter/update keys and select strings — they are
 * not parameterised, so we guard against injection here.
 *
 * Allowed: letters, digits, underscores, dollar signs, and dots (nested paths).
 * Must start with a letter, underscore, or dollar sign.
 */
const VALID_FIELD_RE = /^[a-zA-Z_$][a-zA-Z0-9_$.]*$/;

export function validateFieldName(field: string): void {
  if (!VALID_FIELD_RE.test(field)) {
    throw new Error(
      `[posgoose] Invalid field name: "${field}". ` +
        `Field names must match /^[a-zA-Z_$][a-zA-Z0-9_$.]*$/`
    );
  }
}
