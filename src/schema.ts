import type {
  SchemaDefinition,
  SchemaOptions,
  SchemaFieldDefinition,
  SchemaFieldType,
  NormalizedField,
} from './types.js';

// Sentinel type values exposed on Schema.Types for Mongoose compat
const Mixed = 'Mixed' as const;
const ObjectId = 'ObjectId' as const;

function normalizeField(raw: SchemaFieldDefinition | SchemaFieldType): NormalizedField {
  if (
    raw === String ||
    raw === Number ||
    raw === Boolean ||
    raw === Date ||
    raw === Array ||
    raw === Object ||
    raw === Mixed ||
    raw === ObjectId ||
    Array.isArray(raw)
  ) {
    return {
      type: raw as SchemaFieldType,
      required: false,
      unique: false,
      index: false,
      trim: false,
      lowercase: false,
      uppercase: false,
    };
  }

  const def = raw as SchemaFieldDefinition;
  const type: SchemaFieldType = (def.type as SchemaFieldType) ?? Mixed;

  let required = false;
  let requiredMessage: string | undefined;
  if (Array.isArray(def.required)) {
    required = def.required[0];
    requiredMessage = def.required[1];
  } else {
    required = def.required ?? false;
  }

  return {
    type,
    required,
    requiredMessage,
    default: def.default,
    unique: def.unique ?? false,
    index: def.index ?? false,
    enum: def.enum,
    min: def.min,
    max: def.max,
    minLength: def.minLength,
    maxLength: def.maxLength,
    trim: def.trim ?? false,
    lowercase: def.lowercase ?? false,
    uppercase: def.uppercase ?? false,
    ref: def.ref,
  };
}

export class Schema<T = Record<string, unknown>> {
  readonly fields: Map<string, NormalizedField> = new Map();
  readonly options: Required<Pick<SchemaOptions, 'timestamps' | 'collection' | 'autoIndex'>>;

  // Phase-2 hooks storage
  readonly _preHooks: Map<string, Array<(this: T, next: () => void) => void>> = new Map();
  readonly _postHooks: Map<string, Array<(this: T, result: unknown) => void>> = new Map();

  // Phase-2 methods / statics / virtuals
  readonly methods: Record<string, (...args: unknown[]) => unknown> = {};
  readonly statics: Record<string, (...args: unknown[]) => unknown> = {};

  static Types = {
    Mixed,
    ObjectId,
    String,
    Number,
    Boolean,
    Date,
    Array,
  };

  constructor(definition: SchemaDefinition<T>, options: SchemaOptions = {}) {
    this.options = {
      timestamps: options.timestamps ?? false,
      collection: options.collection ?? '',
      autoIndex: options.autoIndex ?? true,
    };

    for (const [key, raw] of Object.entries(definition)) {
      if (raw !== undefined && raw !== null) {
        this.fields.set(key, normalizeField(raw as SchemaFieldDefinition | SchemaFieldType));
      }
    }
  }

  /** Apply defaults and string transforms to a raw data object */
  applyDefaults(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...data };
    for (const [key, field] of this.fields) {
      if (result[key] === undefined && field.default !== undefined) {
        result[key] = typeof field.default === 'function'
          ? (field.default as () => unknown)()
          : field.default;
      }
      if (typeof result[key] === 'string') {
        let v = result[key] as string;
        if (field.trim) v = v.trim();
        if (field.lowercase) v = v.toLowerCase();
        if (field.uppercase) v = v.toUpperCase();
        result[key] = v;
      }
    }
    return result;
  }

  /** Validate a data object against the schema. Throws ValidationError on failure. */
  validate(data: Record<string, unknown>): void {
    const errors: string[] = [];

    for (const [key, field] of this.fields) {
      const value = data[key];

      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push(field.requiredMessage ?? `Path \`${key}\` is required.`);
        continue;
      }

      if (value === undefined || value === null) continue;

      if (field.enum && !field.enum.includes(value)) {
        errors.push(`\`${value}\` is not a valid enum value for path \`${key}\`.`);
      }

      if (field.type === Number || (field.type as SchemaFieldType) === Number) {
        const n = Number(value);
        if (field.min !== undefined && n < field.min) {
          errors.push(`Path \`${key}\` (${n}) is less than minimum allowed value (${field.min}).`);
        }
        if (field.max !== undefined && n > field.max) {
          errors.push(`Path \`${key}\` (${n}) is more than maximum allowed value (${field.max}).`);
        }
      }

      if (field.type === String || (field.type as SchemaFieldType) === String) {
        const s = String(value);
        if (field.minLength !== undefined && s.length < field.minLength) {
          errors.push(`Path \`${key}\` (\`${s}\`) is shorter than the minimum allowed length (${field.minLength}).`);
        }
        if (field.maxLength !== undefined && s.length > field.maxLength) {
          errors.push(`Path \`${key}\` (\`${s}\`) is longer than the maximum allowed length (${field.maxLength}).`);
        }
      }
    }

    if (errors.length > 0) {
      throw new ValidationError(errors);
    }
  }

  /** Phase 2 stub */
  pre(event: string, fn: (this: T, next: () => void) => void): this {
    const hooks = this._preHooks.get(event) ?? [];
    hooks.push(fn);
    this._preHooks.set(event, hooks);
    return this;
  }

  /** Phase 2 stub */
  post(event: string, fn: (this: T, result: unknown) => void): this {
    const hooks = this._postHooks.get(event) ?? [];
    hooks.push(fn);
    this._postHooks.set(event, hooks);
    return this;
  }
}

export class ValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Validation failed: ${errors.join(', ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}
