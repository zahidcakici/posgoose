import { connect, disconnect, getPool, startSession } from '../src/index';

const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://posgoose:posgoose@localhost:5433/posgoose_test';

describe('connection', () => {
  afterEach(async () => {
    await disconnect();
  });

  it('connects and returns a functional pool', async () => {
    await connect(DB_URL);
    const pool = getPool();
    const result = await pool.query('SELECT 1 AS val');
    expect(result.rows[0].val).toBe(1);
  });

  it('throws when getPool is called before connect', () => {
    expect(() => getPool()).toThrow('[posgoose] Not connected');
  });

  it('startSession returns a usable transaction session', async () => {
    await connect(DB_URL);
    const session = await startSession();
    await session.startTransaction();
    const result = await session.client.query('SELECT 1 AS val');
    expect(result.rows[0].val).toBe(1);
    await session.abortTransaction();
    await session.endSession();
  });
});
