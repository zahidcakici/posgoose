export const PG_URL =
  process.env.PG_URL ?? 'postgresql://bench:bench@localhost:5434/bench';

export const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://localhost:27017/posgoose_bench';

export const RECORD_COUNT = parseInt(process.env.RECORD_COUNT ?? '100000', 10);
export const WARMUP_ITERATIONS = parseInt(process.env.WARMUP ?? '200', 10);
export const BENCH_ITERATIONS = parseInt(process.env.ITERATIONS ?? '1000', 10);

// 1 000 rows × 4 params = 4 000 params per batch — safely under the 65 535 pg limit
export const SEED_BATCH_SIZE = 1_000;
