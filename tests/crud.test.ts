import { connect, disconnect, model, Schema } from '../src/index';

const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://posgoose:posgoose@localhost:5433/posgoose_test';

interface IUser {
  name: string;
  email: string;
  age: number;
  active: boolean;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    age: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const User = model<IUser>('User', userSchema);

beforeAll(async () => {
  await connect(DB_URL);
  await User.dropTable();
});

afterAll(async () => {
  await User.dropTable();
  await disconnect();
});

afterEach(async () => {
  await User.deleteMany({});
});

describe('Model.create', () => {
  it('creates a single document', async () => {
    const user = await User.create({ name: 'Alice', email: 'alice@example.com', age: 30 });
    expect(user._id).toBeDefined();
    expect(user.name).toBe('Alice');
    expect(user.email).toBe('alice@example.com');
    expect(user.age).toBe(30);
  });

  it('creates multiple documents when given an array', async () => {
    const users = await User.create([
      { name: 'Bob', email: 'bob@example.com', age: 25 },
      { name: 'Carol', email: 'carol@example.com', age: 35 },
    ]) as unknown[];
    expect(Array.isArray(users)).toBe(true);
    expect(users).toHaveLength(2);
  });

  it('applies default values', async () => {
    const user = await User.create({ name: 'Dave', email: 'dave@example.com' });
    expect((user as IUser & { _id: string }).age).toBe(0);
    expect((user as IUser & { _id: string }).active).toBe(true);
  });

  it('throws ValidationError on missing required field', async () => {
    await expect(User.create({ name: 'Eve' } as IUser)).rejects.toThrow();
  });
});

describe('Model.find', () => {
  beforeEach(async () => {
    await User.create([
      { name: 'Alice', email: 'alice@example.com', age: 30 },
      { name: 'Bob', email: 'bob@example.com', age: 25 },
      { name: 'Carol', email: 'carol@example.com', age: 35 },
    ]);
  });

  it('returns all documents with empty filter', async () => {
    const users = await User.find();
    expect(users).toHaveLength(3);
  });

  it('filters by field equality', async () => {
    const users = await User.find({ name: 'Alice' } as any);
    expect(users).toHaveLength(1);
    expect((users[0] as any).name).toBe('Alice');
  });

  it('supports sort ascending', async () => {
    const users = await User.find().sort({ age: 1 }).lean();
    const ages = (users as any[]).map(u => u.age);
    expect(ages).toEqual([25, 30, 35]);
  });

  it('supports sort descending', async () => {
    const users = await User.find().sort({ age: -1 }).lean();
    const ages = (users as any[]).map(u => u.age);
    expect(ages).toEqual([35, 30, 25]);
  });

  it('supports limit and skip', async () => {
    const users = await User.find().sort({ age: 1 }).skip(1).limit(1).lean();
    expect(users).toHaveLength(1);
    expect((users[0] as any).age).toBe(30);
  });

  it('supports lean()', async () => {
    const users = await User.find().lean();
    expect(users[0]).not.toHaveProperty('save');
  });
});

describe('Model.findOne', () => {
  beforeEach(async () => {
    await User.create({ name: 'Alice', email: 'alice@example.com', age: 30 });
  });

  it('returns a document', async () => {
    const user = await User.findOne({ name: 'Alice' } as any);
    expect(user).not.toBeNull();
    expect((user as any).email).toBe('alice@example.com');
  });

  it('returns null when not found', async () => {
    const user = await User.findOne({ name: 'Nobody' } as any);
    expect(user).toBeNull();
  });
});

describe('Model.findById', () => {
  it('finds a doc by its _id', async () => {
    const created = await User.create({ name: 'Alice', email: 'alice@example.com' });
    const found = await User.findById((created as any)._id);
    expect(found).not.toBeNull();
    expect((found as any).name).toBe('Alice');
  });
});

describe('Model.updateOne / updateMany', () => {
  beforeEach(async () => {
    await User.create([
      { name: 'Alice', email: 'alice@example.com', age: 30 },
      { name: 'Bob', email: 'bob@example.com', age: 25 },
    ]);
  });

  it('updateOne with $set', async () => {
    const result = await User.updateOne({ name: 'Alice' } as any, { $set: { age: 31 } });
    expect(result.modifiedCount).toBe(1);
    const user = await User.findOne({ name: 'Alice' } as any, { lean: true });
    expect((user as any).age).toBe(31);
  });

  it('updateMany with $set', async () => {
    const result = await User.updateMany({} as any, { $set: { active: false } });
    expect(result.modifiedCount).toBe(2);
  });
});

describe('Model.deleteOne / deleteMany', () => {
  beforeEach(async () => {
    await User.create([
      { name: 'Alice', email: 'alice@example.com', age: 30 },
      { name: 'Bob', email: 'bob@example.com', age: 25 },
    ]);
  });

  it('deleteOne removes a single document', async () => {
    const r = await User.deleteOne({ name: 'Alice' } as any);
    expect(r.deletedCount).toBe(1);
    expect(await User.countDocuments()).toBe(1);
  });

  it('deleteMany removes all matching', async () => {
    const r = await User.deleteMany({});
    expect(r.deletedCount).toBe(2);
    expect(await User.countDocuments()).toBe(0);
  });
});

describe('Model.countDocuments / exists', () => {
  beforeEach(async () => {
    await User.create([
      { name: 'Alice', email: 'alice@example.com', age: 30 },
      { name: 'Bob', email: 'bob@example.com', age: 25 },
    ]);
  });

  it('countDocuments returns total', async () => {
    expect(await User.countDocuments()).toBe(2);
  });

  it('countDocuments with filter', async () => {
    expect(await User.countDocuments({ name: 'Alice' } as any)).toBe(1);
  });

  it('exists returns _id when found', async () => {
    const result = await User.exists({ name: 'Alice' } as any);
    expect(result).not.toBeNull();
    expect(result!._id).toBeDefined();
  });

  it('exists returns null when not found', async () => {
    expect(await User.exists({ name: 'Nobody' } as any)).toBeNull();
  });
});

describe('Document instance methods', () => {
  it('save() persists a new doc', async () => {
    const user = await User.create({ name: 'Alice', email: 'alice@example.com' });
    (user as any).age = 99;
    await (user as any).save();
    const found = await User.findOne({ name: 'Alice' } as any, { lean: true });
    expect((found as any).age).toBe(99);
  });

  it('remove() deletes the doc', async () => {
    const user = await User.create({ name: 'Alice', email: 'alice@example.com' });
    await (user as any).remove();
    expect(await User.countDocuments()).toBe(0);
  });

  it('toObject() returns a plain object', async () => {
    const user = await User.create({ name: 'Alice', email: 'alice@example.com' });
    const obj = (user as any).toObject();
    expect(obj._id).toBeDefined();
    expect(obj.name).toBe('Alice');
  });
});

describe('findByIdAndUpdate', () => {
  it('returns updated document', async () => {
    const user = await User.create({ name: 'Alice', email: 'alice@example.com', age: 30 });
    const updated = await User.findByIdAndUpdate(
      (user as any)._id,
      { $set: { age: 31 } },
      { new: true, lean: true }
    );
    expect((updated as any).age).toBe(31);
  });

  it('returns null for missing id', async () => {
    const result = await User.findByIdAndUpdate('non-existent-id', { $set: { age: 1 } }, { new: true });
    expect(result).toBeNull();
  });
});

describe('transactions', () => {
  it('commits a transaction', async () => {
    const { startSession } = await import('../src/index');
    const session = await startSession();
    await session.startTransaction();
    await User.create(
      { name: 'Tx User', email: 'tx@example.com' },
      { session: session.client }
    );
    await session.commitTransaction();
    await session.endSession();
    expect(await User.countDocuments({ name: 'Tx User' } as any)).toBe(1);
  });

  it('rolls back on abort', async () => {
    const { startSession } = await import('../src/index');
    const session = await startSession();
    await session.startTransaction();
    await User.create(
      { name: 'Rollback User', email: 'rollback@example.com' },
      { session: session.client }
    );
    await session.abortTransaction();
    await session.endSession();
    expect(await User.countDocuments({ name: 'Rollback User' } as any)).toBe(0);
  });
});
