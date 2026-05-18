export { Schema, ValidationError } from './schema.js';
export { Document } from './document.js';
export { Query } from './query/builder.js';
export { connect, disconnect, connection, startSession, getPool } from './connection.js';
export { createModel as model } from './model.js';
export type { ModelClass } from './model.js';
export type {
  SchemaDefinition,
  SchemaFieldDefinition,
  SchemaOptions,
  FilterQuery,
  UpdateQuery,
  QueryOptions,
  SortArg,
  PosgooseSession,
} from './types.js';
