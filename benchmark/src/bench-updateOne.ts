import { performance } from 'perf_hooks';
import mongoose from 'mongoose';
import { connect as pgConnect, disconnect as pgDisconnect, model } from 'posgoose';
import { PG_URL, MONGO_URL, RECORD_COUNT, WARMUP_ITERATIONS, BENCH_ITERATIONS } from './config';
import { calcStats, printTable, saveResults, Stats } from './report';
import { pgUserSchema, mongooseUserSchema, UserData } from './seed';

const randomEmail = () => `user${Math.floor(Math.random() * RECORD_COUNT)}@bench.dev`;
const randomScore = () => Math.floor(Math.random() * 1000);

export async function runUpdateOneBench(opts?: {
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

  console.log(`updateOne — warmup ${warmup} + measure ${iterations} iterations`);

  process.stdout.write('  warming up...');
  for (let i = 0; i < warmup; i++) {
    const email = randomEmail();
    const score = randomScore();
    await PgUser.updateOne({ email }, { $set: { score } });
    await MongoUser.updateOne({ email }, { $set: { score } });
  }
  console.log(' done');

  const pgSamples: number[] = [];
  const mgSamples: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const email = randomEmail();
    const score = randomScore();

    const t0 = performance.now();
    await PgUser.updateOne({ email }, { $set: { score } });
    pgSamples.push(performance.now() - t0);

    const t1 = performance.now();
    await MongoUser.updateOne({ email }, { $set: { score } });
    mgSamples.push(performance.now() - t1);
  }

  await pgDisconnect();
  await mongoose.disconnect();

  return { pg: calcStats(pgSamples), mg: calcStats(mgSamples) };
}

async function main(): Promise<void> {
  const results = await runUpdateOneBench();

  console.log('\nupdateOne results:');
  printTable([
    { label: 'posgoose / PostgreSQL', stats: results.pg },
    { label: 'mongoose  / MongoDB  ', stats: results.mg },
  ]);

  saveResults('updateOne', results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
