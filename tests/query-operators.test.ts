import { connect, disconnect, model, Schema } from '../src/index';

const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://posgoose:posgoose@localhost:5433/posgoose_test';

interface IProduct {
  name: string;
  price: number;
  category: string;
  tags: string[];
  inStock: boolean;
}

const productSchema = new Schema<IProduct>({
  name: String,
  price: Number,
  category: String,
  tags: Array,
  inStock: Boolean,
});

const Product = model<IProduct>('QueryOpProduct', productSchema);

const seed = [
  { name: 'Apple', price: 1.5, category: 'fruit', tags: ['organic', 'fresh'], inStock: true },
  { name: 'Banana', price: 0.5, category: 'fruit', tags: ['fresh'], inStock: true },
  { name: 'Carrot', price: 0.8, category: 'vegetable', tags: ['organic'], inStock: false },
  { name: 'Date', price: 3.0, category: 'fruit', tags: ['dried'], inStock: true },
  { name: 'Eggplant', price: 1.2, category: 'vegetable', tags: ['fresh', 'organic'], inStock: false },
];

beforeAll(async () => {
  await connect(DB_URL);
  await Product.dropTable();
  await Product.create(seed as IProduct[]);
});

afterAll(async () => {
  await Product.dropTable();
  await disconnect();
});

describe('comparison operators', () => {
  it('$gt', async () => {
    const r = await Product.find({ price: { $gt: 1 } } as any).lean();
    expect((r as any[]).every(p => p.price > 1)).toBe(true);
  });

  it('$gte', async () => {
    const r = await Product.find({ price: { $gte: 1.5 } } as any).lean();
    expect((r as any[]).every(p => p.price >= 1.5)).toBe(true);
  });

  it('$lt', async () => {
    const r = await Product.find({ price: { $lt: 1 } } as any).lean();
    expect((r as any[]).every(p => p.price < 1)).toBe(true);
  });

  it('$lte', async () => {
    const r = await Product.find({ price: { $lte: 0.8 } } as any).lean();
    expect((r as any[]).map((p: any) => p.name).sort()).toEqual(['Banana', 'Carrot']);
  });

  it('$ne', async () => {
    const r = await Product.find({ category: { $ne: 'fruit' } } as any).lean();
    expect((r as any[]).every(p => p.category === 'vegetable')).toBe(true);
  });

  it('$eq', async () => {
    const r = await Product.find({ category: { $eq: 'fruit' } } as any).lean();
    expect((r as any[]).every(p => p.category === 'fruit')).toBe(true);
  });
});

describe('array operators', () => {
  it('$in', async () => {
    const r = await Product.find({ category: { $in: ['fruit'] } } as any).lean();
    expect(r).toHaveLength(3);
  });

  it('$nin', async () => {
    const r = await Product.find({ category: { $nin: ['fruit'] } } as any).lean();
    expect(r).toHaveLength(2);
  });

  it('array containment (value in array field)', async () => {
    const r = await Product.find({ tags: 'organic' } as any).lean();
    expect((r as any[]).every(p => p.tags.includes('organic'))).toBe(true);
  });

  it('$all', async () => {
    const r = await Product.find({ tags: { $all: ['organic', 'fresh'] } } as any).lean();
    expect(r).toHaveLength(2); // Apple and Eggplant
  });
});

describe('logical operators', () => {
  it('$and', async () => {
    const r = await Product.find({
      $and: [{ category: 'fruit' }, { price: { $gt: 1 } }],
    } as any).lean();
    expect((r as any[]).every(p => p.category === 'fruit' && p.price > 1)).toBe(true);
  });

  it('$or', async () => {
    const r = await Product.find({
      $or: [{ price: { $lt: 0.6 } }, { price: { $gt: 2.5 } }],
    } as any).lean();
    expect(r).toHaveLength(2); // Banana + Date
  });

  it('$nor', async () => {
    const r = await Product.find({
      $nor: [{ category: 'fruit' }, { category: 'vegetable' }],
    } as any).lean();
    expect(r).toHaveLength(0);
  });
});

describe('element operators', () => {
  it('$exists: true', async () => {
    const r = await Product.find({ inStock: { $exists: true } } as any).lean();
    expect(r).toHaveLength(seed.length);
  });

  it('$exists: false', async () => {
    const r = await Product.find({ nonExistentField: { $exists: false } } as any).lean();
    expect(r).toHaveLength(seed.length);
  });
});

describe('regex operator', () => {
  it('$regex case-sensitive', async () => {
    const r = await Product.find({ name: { $regex: '^A' } } as any).lean();
    expect(r).toHaveLength(1);
    expect((r[0] as any).name).toBe('Apple');
  });

  it('$regex case-insensitive with $options', async () => {
    const r = await Product.find({ name: { $regex: '^a', $options: 'i' } } as any).lean();
    expect(r).toHaveLength(1);
    expect((r[0] as any).name).toBe('Apple');
  });

  it('RegExp literal', async () => {
    const r = await Product.find({ name: /^b/i } as any).lean();
    expect(r).toHaveLength(1);
    expect((r[0] as any).name).toBe('Banana');
  });
});

describe('$not operator', () => {
  it('$not with comparison', async () => {
    const r = await Product.find({ price: { $not: { $gt: 1 } } } as any).lean();
    expect((r as any[]).every(p => p.price <= 1)).toBe(true);
  });
});
