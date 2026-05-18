import mongoose from 'mongoose';
import { connect as pgConnect, disconnect as pgDisconnect, model, Schema } from 'posgoose';
import { PG_URL, MONGO_URL, RECORD_COUNT, SEED_BATCH_SIZE } from './config';

export interface UserData {
  name: string;
  email: string;
  age: number;
  city: string;
  score: number;
  createdAt: Date;
}

// Deterministic seed data — same records land in both DBs
export function generateUsers(count: number): UserData[] {
  const cities = ['New York', 'London', 'Tokyo', 'Berlin', 'Paris', 'Sydney', 'Toronto', 'Dubai'];
  return Array.from({ length: count }, (_, i) => ({
    name: `User ${i}`,
    email: `user${i}@bench.dev`,
    age: 18 + (i % 60),
    city: cities[i % cities.length],
    score: (i * 7 + 42) % 1000,
    createdAt: new Date(Date.now() - (count - i) * 60_000),
  }));
}

export function pgUserSchema() {
  return new Schema<UserData>(
    {
      name: { type: String },
      email: { type: String, index: true },
      age: { type: Number },
      city: { type: String },
      score: { type: Number },
      createdAt: { type: Date },
    },
    { collection: 'bench_users' }
  );
}

export function mongooseUserSchema(): mongoose.Schema {
  return new mongoose.Schema<UserData>(
    {
      name: String,
      email: { type: String, index: true },
      age: Number,
      city: String,
      score: Number,
      createdAt: Date,
    },
    { collection: 'bench_users' }
  );
}

async function seedMongo(users: UserData[]): Promise<void> {
  console.log('MongoDB  — connecting...');
  await mongoose.connect(MONGO_URL);

  const MongoUser = mongoose.model<UserData>('BenchUser', mongooseUserSchema());
  await MongoUser.collection.drop().catch(() => {}); // ignore if first run

  for (let i = 0; i < users.length; i += SEED_BATCH_SIZE) {
    await MongoUser.insertMany(users.slice(i, i + SEED_BATCH_SIZE), { ordered: false });
    process.stdout.write(`\rMongoDB  — ${Math.min(i + SEED_BATCH_SIZE, users.length).toLocaleString()} / ${users.length.toLocaleString()}`);
  }

  await MongoUser.syncIndexes();
  console.log(`\rMongoDB  — ${users.length.toLocaleString()} docs seeded ✓`);
  await mongoose.disconnect();
}

async function seedPostgres(users: UserData[]): Promise<void> {
  console.log('Postgres — connecting...');
  await pgConnect(PG_URL);

  const PgUser = model<UserData>('bench_user', pgUserSchema());
  await PgUser.dropTable();

  for (let i = 0; i < users.length; i += SEED_BATCH_SIZE) {
    await PgUser.insertMany(users.slice(i, i + SEED_BATCH_SIZE));
    process.stdout.write(`\rPostgres — ${Math.min(i + SEED_BATCH_SIZE, users.length).toLocaleString()} / ${users.length.toLocaleString()}`);
  }

  console.log(`\rPostgres — ${users.length.toLocaleString()} rows seeded ✓`);
  await pgDisconnect();
}

async function main(): Promise<void> {
  console.log(`\nSeeding ${RECORD_COUNT.toLocaleString()} records into both databases...\n`);
  const users = generateUsers(RECORD_COUNT);
  await seedMongo(users);
  await seedPostgres(users);
  console.log('\nDone.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
