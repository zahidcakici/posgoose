/**
 * Full benchmark orchestrator.
 * Runs: seed → findOne bench → updateOne bench → combined summary table.
 *
 * Usage: npm run bench
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { printTable, Stats } from './report';

const root = path.join(__dirname, '..');
const tsnode = `ts-node --project ${path.join(root, 'tsconfig.json')}`;

function runScript(script: string, label: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(60));
  execSync(`${tsnode} ${path.join(root, 'src', script)}`, {
    stdio: 'inherit',
    cwd: root,
  });
}

function loadResults(name: string): { pg: Stats; mg: Stats } {
  const file = path.join(root, 'results', `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as { pg: Stats; mg: Stats };
}

async function main(): Promise<void> {
  runScript('seed.ts', 'STEP 1 — Seed databases');
  runScript('bench-findOne.ts', 'STEP 2 — findOne benchmark');
  runScript('bench-updateOne.ts', 'STEP 3 — updateOne benchmark');

  const findOne = loadResults('findOne');
  const updateOne = loadResults('updateOne');

  console.log('\n' + '═'.repeat(60));
  console.log('  COMBINED RESULTS');
  console.log('═'.repeat(60));

  printTable([
    { label: 'PG  findOne ', stats: findOne.pg },
    { label: 'MG  findOne ', stats: findOne.mg },
    { label: 'PG  updateOne', stats: updateOne.pg },
    { label: 'MG  updateOne', stats: updateOne.mg },
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
