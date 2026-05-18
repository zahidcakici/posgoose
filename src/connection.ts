import { Pool, type PoolConfig, type PoolClient } from 'pg';
import type { PosgooseSession } from './types.js';

let _pool: Pool | null = null;

export const connection = {
  readyState: 0 as 0 | 1 | 2 | 3,
  on(event: string, handler: (...args: unknown[]) => void): void {
    if (_pool) (_pool as unknown as NodeJS.EventEmitter).on(event, handler);
  },
};

export async function connect(uri: string, options?: PoolConfig): Promise<void> {
  if (_pool) return;
  _pool = new Pool({ connectionString: uri, ...options });
  _pool.on('error', (err) => {
    console.error('[posgoose] pool error', err);
  });
  // Verify connectivity
  const client = await _pool.connect();
  client.release();
  connection.readyState = 1;
}

export async function disconnect(): Promise<void> {
  if (!_pool) return;
  await _pool.end();
  _pool = null;
  connection.readyState = 0;
}

export function getPool(): Pool {
  if (!_pool) {
    throw new Error('[posgoose] Not connected. Call posgoose.connect() first.');
  }
  return _pool;
}

export async function startSession(): Promise<PosgooseSession> {
  const client: PoolClient = await getPool().connect();
  let inTx = false;

  return {
    client,
    async startTransaction() {
      await client.query('BEGIN');
      inTx = true;
    },
    async commitTransaction() {
      if (!inTx) throw new Error('[posgoose] No active transaction');
      await client.query('COMMIT');
      inTx = false;
    },
    async abortTransaction() {
      if (!inTx) throw new Error('[posgoose] No active transaction');
      await client.query('ROLLBACK');
      inTx = false;
    },
    async endSession() {
      if (inTx) await client.query('ROLLBACK');
      client.release();
    },
  };
}
