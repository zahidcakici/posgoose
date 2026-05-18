import { performance } from 'perf_hooks';
import mongoose from 'mongoose';
import { connect as pgConnect, disconnect as pgDisconnect, model } from 'posgoose';
import { PG_URL, MONGO_URL, RECORD_COUNT, WARMUP_ITERATIONS, BENCH_ITERATIONS } from './config';
import { calcStats, printTable, saveResults, Stats } from './report';
import { pgUserSchema, mongooseUserSchema, UserData } from './seed';

const randomEmail = () => `user${Math.floor(Math.random() * RECORD_COUNT)}@bench.dev`;

export async function runFindOneBench(opts?: {
  warmup?: number;
  iterations?: number;
}): Promise<{ pg: Stats; mg: Stats }> {
  const warmup = opts?.warmup ?? WARMUP_ITERATIONS;
  const iterations = opts?.iterations ?? BENCH_ITERATIONS;

  await pgConnect(PG_URL);
  await mongoose.connect(MONGO_URL);

  const PgUser = model<UserData>('bench_user', pgUserSchema());
  const MongoUser =
    (mongoose.models['BenchUser'] as mongoose.Model<UserData>) ??
    mongoose.model<UserData>('BenchUser', mongooseUserSchema());

  console.log(`findOne — warmup ${warmup} + measure ${iterations} iterations`);

  // Warmup: run both DBs equally to prime caches
  process.stdout.write('  warming up...');
  for (let i = 0; i < warmup; i++) {
    const email = randomEmail();
    await PgUser.findOne({ email }, { lean: true });
    await MongoUser.findOne({ email }).lean();
  }
  console.log(' done');

  const pgSamples: number[] = [];
  const mgSamples: number[] = [];

  // Interleaved measurement — evens out any background noise over time
  for (let i = 0; i < iterations; i++) {
    const email = randomEmail();

    const t0 = performance.now();
    await PgUser.findOne({ email }, { lean: true });
    pgSamples.push(performance.now() - t0);

    const t1 = performance.now();
    await MongoUser.findOne({ email }).lean();
    mgSamples.push(performance.now() - t1);
  }

  await pgDisconnect();
  await mongoose.disconnect();

  return { pg: calcStats(pgSamples), mg: calcStats(mgSamples) };
}

async function main(): Promise<void> {
  const results = await runFindOneBench();

  console.log('\nfindOne results:');
  printTable([
    { label: 'posgoose / PostgreSQL', stats: results.pg },
    { label: 'mongoose  / MongoDB  ', stats: results.mg },
  ]);

  saveResults('findOne', results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
