import { connect, disconnect, model, Schema } from '../src/index';

const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://posgoose:posgoose@localhost:5433/posgoose_test';

interface IDoc {
  name: string;
  score: number;
  tags: string[];
  meta: { views: number };
}

const docSchema = new Schema<IDoc>({
  name: String,
  score: Number,
  tags: Array,
  meta: Schema.Types.Mixed,
});

const Doc = model<IDoc>('UpdateOpDoc', docSchema);

beforeAll(async () => {
  await connect(DB_URL);
  await Doc.dropTable();
});

afterAll(async () => {
  await Doc.dropTable();
  await disconnect();
});

beforeEach(async () => {
  await Doc.deleteMany({});
  await Doc.create({ name: 'test', score: 10, tags: ['a', 'b'], meta: { views: 5 } } as IDoc);
});

async function getDoc() {
  return Doc.findOne({ name: 'test' } as any, { lean: true }) as any;
}

describe('update operators', () => {
  it('$set updates a field', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $set: { score: 99 } });
    expect((await getDoc()).score).toBe(99);
  });

  it('$unset removes a field', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $unset: { score: '' } });
    const d = await getDoc();
    expect(d.score).toBeUndefined();
  });

  it('$inc increments a numeric field', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $inc: { score: 5 } });
    expect((await getDoc()).score).toBe(15);
  });

  it('$inc decrements when given negative', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $inc: { score: -3 } });
    expect((await getDoc()).score).toBe(7);
  });

  it('$mul multiplies a numeric field', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $mul: { score: 2 } });
    expect((await getDoc()).score).toBe(20);
  });

  it('$push appends to an array', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $push: { tags: 'c' } });
    expect((await getDoc()).tags).toContain('c');
  });

  it('$pull removes a value from an array', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $pull: { tags: 'a' } });
    const d = await getDoc();
    expect(d.tags).not.toContain('a');
    expect(d.tags).toContain('b');
  });

  it('$addToSet adds a new value', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $addToSet: { tags: 'c' } });
    expect((await getDoc()).tags).toContain('c');
  });

  it('$addToSet does not duplicate', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $addToSet: { tags: 'a' } });
    const d = await getDoc();
    expect(d.tags.filter((t: string) => t === 'a').length).toBe(1);
  });

  it('$pop removes last element', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $pop: { tags: 1 } });
    const d = await getDoc();
    expect(d.tags).toEqual(['a']);
  });

  it('$pop removes first element', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $pop: { tags: -1 } });
    const d = await getDoc();
    expect(d.tags).toEqual(['b']);
  });

  it('$rename renames a field', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $rename: { score: 'points' } });
    const d = await getDoc();
    expect(d.score).toBeUndefined();
    expect(d.points).toBe(10);
  });

  it('$min keeps smaller value', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $min: { score: 5 } });
    expect((await getDoc()).score).toBe(5);
  });

  it('$min keeps existing when smaller', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $min: { score: 20 } });
    expect((await getDoc()).score).toBe(10);
  });

  it('$max keeps larger value', async () => {
    await Doc.updateOne({ name: 'test' } as any, { $max: { score: 50 } });
    expect((await getDoc()).score).toBe(50);
  });

  it('full document replacement', async () => {
    await Doc.updateOne({ name: 'test' } as any, { name: 'replaced', score: 0, tags: [], meta: { views: 0 } } as any);
    const d = await getDoc();
    expect(d).toBeNull(); // name changed
    const r = await Doc.findOne({ name: 'replaced' } as any, { lean: true }) as any;
    expect(r.score).toBe(0);
  });
});
