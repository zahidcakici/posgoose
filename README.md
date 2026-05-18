# posgoose

**PostgreSQL JSONB ODM — a drop-in replacement for Mongoose.**

posgoose gives you the Mongoose API you already know, backed by PostgreSQL JSONB instead of MongoDB. Each model maps to a PostgreSQL table with a UUID v7 primary key and a single `data JSONB` column, so migrating an existing Mongoose project means swapping the import and the connection string — most of your model definitions, queries, and update operators just work.

```ts
// Before
import mongoose from 'mongoose';
await mongoose.connect('mongodb://...');

// After
import * as posgoose from 'posgoose';
await posgoose.connect('postgresql://...');
```

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Connection](#connection)
- [Schema](#schema)
- [Models](#models)
- [Querying](#querying)
- [Updating](#updating)
- [Document Instances](#document-instances)
- [Transactions](#transactions)
- [TypeScript](#typescript)
- [Performance & Indexing](#performance--indexing)
- [Security](#security)
- [Benchmark](#benchmark)
- [Feature Support Matrix](#feature-support-matrix)
- [Migration Guide](#migration-guide)

---

## Installation

```bash
npm install posgoose
# or
yarn add posgoose
```

Requires PostgreSQL 12+ and Node.js 18+.

---

## Quick Start

```ts
import * as posgoose from 'posgoose';

// 1. Connect
await posgoose.connect('postgresql://user:pass@localhost:5432/mydb');

// 2. Define a schema
interface IUser {
  name: string;
  email: string;
  age: number;
}

const userSchema = new posgoose.Schema<IUser>(
  {
    name:  { type: String, required: true },
    email: { type: String, required: true, unique: true },
    age:   { type: Number, default: 0 },
  },
  { timestamps: true }
);

// 3. Create a model — table + indexes are auto-created on first use
const User = posgoose.model<IUser>('User', userSchema);

// 4. Use it exactly like Mongoose
const alice = await User.create({ name: 'Alice', email: 'alice@example.com', age: 30 });
console.log(alice._id); // UUID v7

const users = await User.find({ age: { $gte: 18 } }).sort({ name: 1 }).lean();
await User.updateOne({ _id: alice._id }, { $inc: { age: 1 } });
await alice.remove();
```

---

## Connection

```ts
import { connect, disconnect, connection, startSession, getPool } from 'posgoose';

// Connect (accepts any pg PoolConfig options as second arg)
await connect('postgresql://localhost:5432/mydb', {
  max: 10,           // pool size
  idleTimeoutMillis: 30000,
});

// Check state (0=disconnected, 1=connected)
console.log(connection.readyState);

// Listen to pool errors
connection.on('error', (err) => console.error(err));

// Raw pool access for custom queries
const pool = getPool();
const { rows } = await pool.query('SELECT NOW()');

// Disconnect
await disconnect();
```

---

## Schema

### Field Types

```ts
const schema = new Schema({
  name:      String,
  age:       Number,
  active:    Boolean,
  birthday:  Date,
  tags:      Array,
  metadata:  Schema.Types.Mixed,    // arbitrary object, no validation
  authorId:  Schema.Types.ObjectId, // stored as UUID v7 string
});
```

### Field Options

| Option | Type | Description |
|--------|------|-------------|
| `type` | constructor | Field type (`String`, `Number`, `Boolean`, `Date`, `Array`) |
| `required` | `boolean \| [boolean, string]` | Throw ValidationError if missing |
| `default` | `value \| () => value` | Default value (function evaluated per-document) |
| `unique` | `boolean` | Create a unique btree index on this field |
| `index` | `boolean` | Create a btree index on this field |
| `enum` | `unknown[]` | Allowed values |
| `min` / `max` | `number` | Numeric range |
| `minLength` / `maxLength` | `number` | String length range |
| `trim` | `boolean` | Trim whitespace before save |
| `lowercase` / `uppercase` | `boolean` | Coerce case before save |
| `ref` | `string` | Model name for populate (Phase 2) |

### Schema Options

```ts
new Schema(definition, {
  timestamps: true,          // auto-manages created_at / updated_at columns
  collection: 'my_table',   // override default table name (default: modelName + 's')
  autoIndex:  true,         // create unique/index field indexes on startup (default: true)
});
```

`autoIndex: true` (the default) runs `syncIndexes()` automatically the first time the model is used. Set it to `false` in environments where you manage schema migrations separately.

---

## Models

```ts
const User = posgoose.model<IUser>('User', userSchema);
```

On first use posgoose:
1. Creates the table if it doesn't exist (`CREATE TABLE IF NOT EXISTS`)
2. Creates a GIN index on the `data` JSONB column
3. Creates any `unique`/`index` field btree indexes (when `autoIndex: true`)

You can also call `User.syncIndexes()` manually at any point to rebuild field indexes.

### CRUD Methods

#### `Model.create(doc | docs[], opts?)`
```ts
const user  = await User.create({ name: 'Alice', email: 'a@example.com' });
const users = await User.create([{ ... }, { ... }]);  // single round-trip INSERT
```

#### `Model.find(filter?, opts?)`
Returns a chainable `Query` (see [Querying](#querying)).
```ts
const users = await User.find({ active: true });
```

#### `Model.findOne(filter?, opts?)`
```ts
const user = await User.findOne({ email: 'a@example.com' });
```

#### `Model.findById(id, opts?)`
```ts
const user = await User.findById('01952c...');
// Passing a structurally invalid ID returns null (no DB round-trip)
```

#### `Model.findByIdAndUpdate(id, update, opts?)`
```ts
const updated = await User.findByIdAndUpdate(id, { $inc: { age: 1 } }, { new: true });
```

#### `Model.findByIdAndDelete(id, opts?)`
```ts
const deleted = await User.findByIdAndDelete(id);
```

#### `Model.findOneAndUpdate(filter, update, opts?)`
```ts
const doc = await User.findOneAndUpdate(
  { email: 'a@example.com' },
  { $set: { active: false } },
  { new: true, lean: true, select: 'name email active' }
);
```

Options: `{ new, upsert, lean, select, session }`

#### `Model.findOneAndDelete(filter, opts?)`
```ts
const doc = await User.findOneAndDelete({ email: 'a@example.com' });
```

#### `Model.updateOne(filter, update, opts?)`
```ts
const { modifiedCount } = await User.updateOne({ name: 'Alice' }, { $set: { age: 31 } });
```

#### `Model.updateMany(filter, update, opts?)`
```ts
await User.updateMany({ active: false }, { $unset: { sessionToken: '' } });
```

#### `Model.deleteOne(filter, opts?)`
```ts
await User.deleteOne({ email: 'a@example.com' });
```

#### `Model.deleteMany(filter?, opts?)`
```ts
await User.deleteMany({ active: false });
await User.deleteMany({}); // clear all
```

#### `Model.countDocuments(filter?, opts?)`
```ts
const count = await User.countDocuments({ active: true });
```

#### `Model.exists(filter, opts?)`
```ts
const hit = await User.exists({ email: 'a@example.com' });
// returns { _id: '...' } | null
```

#### `Model.insertMany(docs[], opts?)`
```ts
await User.insertMany([{ ... }, { ... }]);  // single round-trip INSERT
```

#### `Model.syncIndexes()`
Creates (or re-creates) `unique` and `index` btree indexes declared in the schema.

#### `Model.dropTable()`
Drops the underlying PostgreSQL table. Useful in tests.

---

## Querying

`find()` returns a chainable `Query` that is also a `PromiseLike`, so you can `await` it directly or chain methods first.

```ts
const users = await User
  .find({ active: true })
  .sort({ createdAt: -1 })   // or .sort('-createdAt')
  .skip(20)
  .limit(10)
  .select('name email -_id') // or .select({ name: 1, email: 1 })
  .lean();                    // returns plain objects instead of Document instances
```

`.select()` is always pushed to the database as a SQL projection — no extra data is fetched then discarded.

- **Inclusion** (`'name email'` / `{ name: 1 }`) → `jsonb_build_object('name', data->'name', …) AS data`
- **Exclusion** (`'-password'` / `{ password: 0 }`) → `data - ARRAY['password']::text[] AS data`

> **Note on nested field projection:** For a nested select like `'address.city'`, posgoose currently includes the full top-level key (`address`) rather than only the requested sub-key. Use `.lean()` with post-processing for precise nested projection.

### Supported Query Operators

#### Comparison
| Operator | Example |
|----------|---------|
| `$eq` | `{ age: { $eq: 25 } }` |
| `$ne` | `{ status: { $ne: 'banned' } }` |
| `$gt` | `{ price: { $gt: 10 } }` |
| `$gte` | `{ price: { $gte: 10 } }` |
| `$lt` | `{ price: { $lt: 100 } }` |
| `$lte` | `{ price: { $lte: 100 } }` |

#### Array
| Operator | Example |
|----------|---------|
| `$in` | `{ role: { $in: ['admin', 'mod'] } }` |
| `$nin` | `{ role: { $nin: ['banned'] } }` |
| `$all` | `{ tags: { $all: ['node', 'pg'] } }` |
| `$size` | `{ tags: { $size: 3 } }` |
| `$elemMatch` | `{ scores: { $elemMatch: { value: { $gt: 80 } } } }` |
| array contains | `{ tags: 'postgres' }` — field is array, value is element |

#### Logical
| Operator | Example |
|----------|---------|
| `$and` | `{ $and: [{ a: 1 }, { b: 2 }] }` |
| `$or` | `{ $or: [{ price: { $lt: 5 } }, { sale: true }] }` |
| `$nor` | `{ $nor: [{ banned: true }, { deleted: true }] }` |
| `$not` | `{ age: { $not: { $lt: 18 } } }` |

#### Element
| Operator | Example |
|----------|---------|
| `$exists` | `{ phone: { $exists: true } }` |
| `$type` | `{ value: { $type: 'number' } }` |

#### Evaluation
| Operator | Example |
|----------|---------|
| `$regex` | `{ name: { $regex: '^Al', $options: 'i' } }` |
| JS RegExp | `{ name: /^Al/i }` |

#### Dot Notation
```ts
// Nested field access in filters and updates
await User.find({ 'address.city': 'Istanbul' });
await User.updateOne({ _id: id }, { $set: { 'address.city': 'Ankara' } });
```

---

## Updating

### Supported Update Operators

#### Field
| Operator | Example |
|----------|---------|
| `$set` | `{ $set: { name: 'Bob', 'address.city': 'NY' } }` |
| `$unset` | `{ $unset: { temporaryToken: '' } }` |
| `$inc` | `{ $inc: { views: 1, score: -5 } }` |
| `$mul` | `{ $mul: { price: 0.9 } }` |
| `$rename` | `{ $rename: { oldName: 'newName' } }` |
| `$min` | `{ $min: { lowestScore: 50 } }` |
| `$max` | `{ $max: { highScore: 100 } }` |

#### Array
| Operator | Example |
|----------|---------|
| `$push` | `{ $push: { tags: 'nodejs' } }` |
| `$pull` | `{ $pull: { tags: 'deprecated' } }` |
| `$addToSet` | `{ $addToSet: { roles: 'editor' } }` |
| `$pop` | `{ $pop: { items: 1 } }` (`1`=last, `-1`=first) |

#### Full Document Replace
If no `$` operators are present, the document is fully replaced (minus `_id`):
```ts
await User.updateOne({ _id: id }, { name: 'New Name', email: 'new@example.com', age: 25 });
```

---

## Document Instances

`create()` and `find*` methods return `Document` instances (unless `.lean()` is used).

```ts
const user = await User.findById(id);

// Property access
console.log(user.name);       // direct field access via Proxy

// Getters / setters
user.set('address.city', 'Istanbul');
console.log(user.get('address.city'));

// Dirty tracking
user.age = 31;
console.log(user.isModified('age')); // true
user.markModified('meta');           // manual dirty flag for nested mutations

// Persistence
await user.save();   // INSERT if isNew, UPDATE otherwise (only modified paths)
await user.remove(); // or user.deleteOne()

// Serialization
const plain = user.toObject();
const json  = user.toJSON(); // same, called by JSON.stringify
```

---

## Transactions

```ts
import { startSession } from 'posgoose';

const session = await startSession();
await session.startTransaction();

try {
  await Order.create({ userId: '...', total: 99 }, { session: session.client });
  await Inventory.updateOne(
    { sku: 'ABC' },
    { $inc: { quantity: -1 } },
    { session: session.client }
  );
  await session.commitTransaction();
} catch (err) {
  await session.abortTransaction();
  throw err;
} finally {
  await session.endSession();
}
```

---

## TypeScript

posgoose is written in TypeScript and ships its own `.d.ts` files.

```ts
import { Schema, model } from 'posgoose';

interface IPost {
  title: string;
  body: string;
  views: number;
  tags: string[];
}

const postSchema = new Schema<IPost>({
  title: { type: String, required: true },
  body:  String,
  views: { type: Number, default: 0 },
  tags:  Array,
});

const Post = model<IPost>('Post', postSchema);

// Fully typed:
const post = await Post.findOne({ title: 'Hello' });
post?.title;   // string
post?.views;   // number
```

---

## Performance & Indexing

### How posgoose stores data

Each model has this table shape:

```sql
CREATE TABLE users (
  _id         UUID        PRIMARY KEY,   -- 16 bytes, time-sortable UUID v7
  data        JSONB       NOT NULL,      -- all user-defined fields
  created_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ
);
```

### GIN index — what it covers and what it doesn't

posgoose automatically creates a GIN index on the `data` column:

```sql
CREATE INDEX users_data_gin ON users USING GIN (data);
```

**The GIN index accelerates:**
- `$exists` queries (`data ? 'field'`)
- Array containment (`data @> '["value"]'`)
- `$all` queries

**The GIN index does NOT accelerate:**
- Equality queries: `data->>'email' = $1`
- Range queries: `(data->'age')::numeric > $1`
- Regex queries: `data->>'name' ~ $1`

For these patterns, a dedicated btree index on the expression is needed. Mark the field with `index: true` or `unique: true` in the schema:

```ts
const userSchema = new Schema({
  email: { type: String, unique: true },  // CREATE UNIQUE INDEX ON (data->>'email')
  age:   { type: Number, index: true },   // CREATE INDEX ON ((data->>'age'))
  name:  String,                          // no index — full scan if filtered frequently
});
```

These btree indexes are created automatically at startup (`autoIndex: true`). Without them, any filtered query on an unindexed field performs a full table scan regardless of collection size.

**Rule of thumb:** add `index: true` to every field you filter or sort on regularly.

### Bulk inserts

`create([...])` and `insertMany()` send a single `INSERT … VALUES (…), (…), …` statement regardless of array size. There is no per-document round-trip overhead.

### Query projection

`.select()` is always translated to a SQL expression (`jsonb_build_object` for inclusion, `data - ARRAY[…]` for exclusion) and applied before data is sent over the wire. Only the requested fields travel from PostgreSQL to your application.

### UUID v7 ordering

`_id` is stored as a native `UUID` column (16 bytes). UUID v7 embeds a millisecond timestamp in the most-significant bits, so `ORDER BY _id` is chronological with no additional column needed.

---

## Security

### Field name validation

Every field name that posgoose interpolates into a SQL string (filter keys, update operator keys, `select` field names, `$elemMatch` sub-keys, `$pull` condition keys, `$rename` source and target) is validated before use.

Allowed pattern: `/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/`

An invalid field name throws immediately:

```ts
// Safe — value is a parameterised query argument ($1)
await User.find({ email: req.body.email });

// Throws — field name contains illegal characters
await User.find({ ["'; DROP TABLE users; --"]: 'value' });
// Error: [posgoose] Invalid field name: "'; DROP TABLE users; --"
```

In standard usage, filter keys come from application code (hardcoded strings), so injection via field names is a concern only if you construct filter objects from user-controlled input dynamically. posgoose catches this case.

### What is always safe

- All filter and update **values** are passed as parameterised arguments (`$1`, `$2`, …) and never interpolated.
- Table names are derived from the model name (developer-controlled) and quoted with double-quotes.
- `$regex` patterns are parameterised.

---

## Benchmark

Serial latency comparison between **posgoose + PostgreSQL 18** and **mongoose + MongoDB 8**, run under identical conditions.

**Environment**

| | |
|---|---|
| Dataset | 100,000 documents, `email` field indexed on both sides |
| Iterations | 1,000 measured (after 200 warmup) |
| Timing | `performance.now()` per-call, interleaved PG/MG |
| CPU limit | 2.0 vCPUs each (Docker) |
| Memory limit | 512 MB each (Docker) |
| PG tuning | `shared_buffers=128MB`, `work_mem=8MB`, `synchronous_commit=off` |
| MG tuning | `--wiredTigerCacheSizeGB 0.25` |
| Query | `findOne({ email })` / `updateOne({ email }, { $set: { score } })` |
| Host | macOS, Apple M-series, Docker Desktop |

**Results** _(lower is better, all times in ms)_

| Operation | min | mean | p50 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| posgoose `findOne` | 0.217 | 0.306 | 0.284 | 0.383 | 0.721 | 2.070 |
| mongoose `findOne` | 0.223 | 0.344 | 0.317 | 0.455 | 0.663 | 2.880 |
| posgoose `updateOne` | 0.258 | 0.402 | 0.371 | 0.522 | 0.834 | 4.619 |
| mongoose `updateOne` | 0.291 | 0.431 | 0.397 | 0.592 | 0.911 | 6.017 |

posgoose is **~12% faster** at `findOne` (mean) and **~7% faster** at `updateOne` under these conditions. The gap is consistent across p50–p99, suggesting it is structural rather than noise.

The main contributing factors are PostgreSQL's mature btree index implementation, the compact UUID column type (16 bytes vs BSON ObjectId), and the absence of document hydration overhead when using `.lean()`.

> Results will vary by hardware, dataset size, and workload shape. Re-run with `cd benchmark && npm run bench` after starting the Docker containers (`docker compose up -d`).

---

## Feature Support Matrix

### ✅ Fully Supported

| Feature | Notes |
|---------|-------|
| `connect()` / `disconnect()` | Standard pg connection string |
| `startSession()` | Wraps a pg client in BEGIN/COMMIT/ROLLBACK |
| `Schema` definition | String, Number, Boolean, Date, Array, Mixed, ObjectId |
| Schema validation | required, enum, min/max, minLength/maxLength, trim, lowercase, uppercase |
| `timestamps` option | Stored as top-level `created_at` / `updated_at` columns |
| `autoIndex` option | Creates field btree indexes on startup (default: `true`) |
| `Model.create()` | Single and array form — single-statement INSERT for arrays |
| `Model.insertMany()` | Single-statement INSERT |
| `Model.find()` | Returns chainable Query |
| `Model.findOne()` | |
| `Model.findById()` | Invalid UUID returns `null` without hitting the DB |
| `Model.findByIdAndUpdate()` | Supports `new`, `upsert`, `lean`, `select`, `session` |
| `Model.findByIdAndDelete()` | |
| `Model.findOneAndUpdate()` | |
| `Model.findOneAndDelete()` | |
| `Model.updateOne()` | |
| `Model.updateMany()` | |
| `Model.deleteOne()` | |
| `Model.deleteMany()` | |
| `Model.countDocuments()` | |
| `Model.exists()` | Returns `{ _id }` or `null` |
| `Model.syncIndexes()` | Creates/rebuilds unique and index btree expressions |
| Query operators | `$eq $ne $gt $gte $lt $lte $in $nin $and $or $nor $not $exists $regex $all $size $elemMatch $type` |
| Update operators | `$set $unset $inc $mul $push $pull $addToSet $pop $rename $min $max` |
| Full document replacement | When no `$` operator is present |
| Array containment queries | `{ tags: 'value' }` |
| Dot-notation filters/updates | `'address.city'` |
| Query builder chaining | `.sort().skip().limit().select().lean().exec()` |
| `.select()` SQL projection | Pushed to DB for `find`, `findOne`, `findOneAndUpdate`, `findOneAndDelete` |
| `doc.save()` | INSERT for new docs, UPDATE (modified paths only) for existing |
| `doc.remove()` / `doc.deleteOne()` | |
| `doc.toObject()` / `doc.toJSON()` | |
| `doc.set()` / `doc.get()` | Dot-notation |
| `doc.isModified()` / `doc.markModified()` | |
| `doc.validate()` | Runs schema validators |
| `doc.$session()` | Attach a transaction client |
| UUID v7 `_id` | Stored as native `UUID` column (16 bytes); `ORDER BY _id` is chronological |
| GIN index on JSONB | Auto-created per table; covers `$exists`, containment, `$all` |
| Btree indexes on fields | Auto-created for `unique`/`index` schema fields |
| Field name injection guard | All interpolated field names are validated against a strict allowlist |
| TypeScript generics | `model<IUser>()` |
| Dual CJS + ESM output | |

---

### ⚠️ Partially Supported

| Feature | Status | Notes |
|---------|--------|-------|
| `schema.pre()` / `schema.post()` | Stored, not yet executed | Phase 2. Hooks are registered but not called yet. |
| `schema.methods` / `schema.statics` | Object exists, not wired | Phase 2. |
| Virtuals | Phase 2 | `schema.virtual()` not yet implemented. |
| `populate()` | Phase 2 | Single-level only when added; no deep chains. |
| `{ upsert: true }` in `findOneAndUpdate` | Works | Falls back to `create()` on no match. `new: false` returns the updated doc rather than the pre-update snapshot. |
| `$elemMatch` | Basic only | Operator comparisons inside `$elemMatch` (`$gt/$gte/$lt/$lte/$eq/$ne`) work; nested `$and/$or` inside `$elemMatch` do not. |
| Nested field projection in `.select()` | Top-level key included | `select('address.city')` returns the full `address` object, not only `city`. |
| `doc.isNew` | Correct | `true` before first `save()`; `false` after. |

---

### ❌ Not Supported

| Feature | Alternative |
|---------|-------------|
| `Model.aggregate()` | Use `getPool().query()` for raw SQL / `WITH`, `GROUP BY`, etc. |
| Change streams / `Model.watch()` | Use PostgreSQL `LISTEN/NOTIFY` directly. |
| GridFS | Store files in S3 / filesystem; save the URL in JSONB. |
| Discriminators (schema inheritance) | Use a `type` field + manual querying. |
| `$text` full-text search | Use PostgreSQL `tsvector` / `to_tsquery` via raw query. |
| Capped collections | No direct equivalent in PostgreSQL. |
| `mongoose.Types.ObjectId` construction | Use UUID v7 strings directly. |
| `$where` JS expressions | Security risk; use `$and`/`$or` instead. |
| Cursor streaming (`find().cursor()`) | Use `getPool()` + pg cursor package. |
| `bulkWrite()` mixed operations | Issue individual operations inside a transaction. |
| `Model.hydrate()` | Not implemented. |
| Multiple connections / `createConnection()` | Call `connect()` once; use `$session` for transactions. |
| Schema `mixed` deep dirty tracking | Call `doc.markModified('fieldName')` manually after mutating a nested object. |

---

## Migration Guide

### 1. Replace the import and connection call

```diff
-import mongoose from 'mongoose';
-await mongoose.connect('mongodb://localhost:27017/mydb');
+import * as posgoose from 'posgoose';
+await posgoose.connect('postgresql://localhost:5432/mydb');
```

### 2. Replace `mongoose.Schema` and `mongoose.model`

```diff
-import { Schema, model } from 'mongoose';
+import { Schema, model } from 'posgoose';
```

The `Schema` constructor, field definitions, and `model()` call are identical.

### 3. `_id` is now a UUID v7 string, not an ObjectId

```diff
-if (mongoose.Types.ObjectId.isValid(id)) { ... }
+import { isValidId } from 'posgoose/utils/uuid'; // optional helper
```

Comparisons like `user._id === someId` still work because both are strings.

### 4. Add `index: true` to filtered fields

MongoDB auto-creates a full-collection index; PostgreSQL JSONB does not. For any field you `find`, `sort`, or `findOneAndUpdate` on regularly, add `index: true` (or `unique: true`) to the schema definition. Without it, every query on that field is a full table scan.

```ts
// Before (works in Mongoose without a declared index)
const userSchema = new Schema({ email: String });

// After (needs explicit index for efficient queries in posgoose)
const userSchema = new Schema({ email: { type: String, index: true } });
```

### 5. No `mongoose.connect()` events — use `connection.readyState`

```diff
-mongoose.connection.on('connected', () => ...);
+import { connection } from 'posgoose';
+connection.on('error', (err) => ...);
```

### 6. Aggregation pipeline has no equivalent

Replace `Model.aggregate([...])` with raw SQL via `getPool().query()`:

```ts
const { rows } = await posgoose.getPool().query(`
  SELECT data->>'category' AS category, COUNT(*) AS total
  FROM products
  GROUP BY data->>'category'
`);
```

---

## Contributing

Issues and PRs are welcome. Please open an issue before submitting large changes.

## License

MIT
