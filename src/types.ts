import type { PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Schema definition types
// ---------------------------------------------------------------------------

export type SchemaTypeConstructor =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | DateConstructor
  | ArrayConstructor
  | ObjectConstructor;

export type SchemaFieldType = SchemaTypeConstructor | [SchemaTypeConstructor] | 'Mixed' | 'ObjectId';

export interface SchemaFieldDefinition {
  type?: SchemaFieldType;
  required?: boolean | [boolean, string];
  default?: unknown;
  unique?: boolean;
  index?: boolean;
  enum?: unknown[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  trim?: boolean;
  lowercase?: boolean;
  uppercase?: boolean;
  ref?: string;
}

export type SchemaDefinition<T = Record<string, unknown>> = {
  [K in keyof T]?: SchemaFieldDefinition | SchemaFieldType;
};

export interface SchemaOptions {
  timestamps?: boolean;
  collection?: string;
  /** Auto-create field indexes (unique/index) when the model first initialises. Default: true */
  autoIndex?: boolean;
}

// ---------------------------------------------------------------------------
// Normalized internal field descriptor
// ---------------------------------------------------------------------------

export interface NormalizedField {
  type: SchemaFieldType;
  required: boolean;
  requiredMessage?: string;
  default?: unknown;
  unique: boolean;
  index: boolean;
  enum?: unknown[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  trim: boolean;
  lowercase: boolean;
  uppercase: boolean;
  ref?: string;
}

// ---------------------------------------------------------------------------
// Query filter / update types (MongoDB-compatible shapes)
// ---------------------------------------------------------------------------

export type FilterValue =
  | string
  | number
  | boolean
  | null
  | RegExp
  | Date
  | FilterOperators
  | FilterValue[];

export interface FilterOperators {
  $eq?: unknown;
  $ne?: unknown;
  $gt?: number | Date | string;
  $gte?: number | Date | string;
  $lt?: number | Date | string;
  $lte?: number | Date | string;
  $in?: unknown[];
  $nin?: unknown[];
  $exists?: boolean;
  $not?: FilterOperators;
  $regex?: string | RegExp;
  $options?: string;
  $all?: unknown[];
  $size?: number;
  $elemMatch?: FilterQuery<unknown>;
  $type?: string;
}

export type FilterQuery<T = Record<string, unknown>> = {
  [K in keyof T]?: FilterValue;
} & {
  $and?: FilterQuery<T>[];
  $or?: FilterQuery<T>[];
  $nor?: FilterQuery<T>[];
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Update operators
// ---------------------------------------------------------------------------

export interface UpdateOperators {
  $set?: Record<string, unknown>;
  $unset?: Record<string, unknown>;
  $inc?: Record<string, number>;
  $mul?: Record<string, number>;
  $push?: Record<string, unknown>;
  $pull?: Record<string, unknown>;
  $addToSet?: Record<string, unknown>;
  $pop?: Record<string, 1 | -1>;
  $rename?: Record<string, string>;
  $min?: Record<string, number | Date>;
  $max?: Record<string, number | Date>;
}

export type UpdateQuery<T = Record<string, unknown>> = UpdateOperators | Partial<T>;

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------

export interface QueryOptions {
  sort?: SortArg;
  limit?: number;
  skip?: number;
  select?: string | Record<string, 0 | 1>;
  lean?: boolean;
  new?: boolean;
  upsert?: boolean;
  session?: PoolClient;
  runValidators?: boolean;
}

export type SortArg =
  | string
  | Record<string, 1 | -1 | 'asc' | 'desc'>;

// ---------------------------------------------------------------------------
// Raw DB row shape returned by pg
// ---------------------------------------------------------------------------

export interface DbRow {
  _id: string;
  data: Record<string, unknown>;
  created_at: Date | null;
  updated_at: Date | null;
}

// ---------------------------------------------------------------------------
// Translated SQL fragment
// ---------------------------------------------------------------------------

export interface SqlFragment {
  sql: string;
  params: unknown[];
  nextParamIndex: number;
}

// ---------------------------------------------------------------------------
// Session (thin wrapper over pg PoolClient)
// ---------------------------------------------------------------------------

export interface PosgooseSession {
  startTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  abortTransaction(): Promise<void>;
  endSession(): Promise<void>;
  /** The underlying pg client — pass as `session` option to Model methods */
  client: PoolClient;
}
