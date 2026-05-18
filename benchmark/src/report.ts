import * as fs from 'fs';
import * as path from 'path';

export interface Stats {
  min: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  max: number;
  count: number;
}

export function calcStats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    mean: sum / n,
    median: sorted[Math.floor(n / 2)],
    p95: sorted[Math.floor(n * 0.95)],
    p99: sorted[Math.floor(n * 0.99)],
    max: sorted[n - 1],
    count: n,
  };
}

export function printTable(rows: Array<{ label: string; stats: Stats }>): void {
  const headers = ['Operation', 'min (ms)', 'mean (ms)', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)', 'max (ms)'];

  const data = rows.map(({ label, stats }) => [
    label,
    stats.min.toFixed(3),
    stats.mean.toFixed(3),
    stats.median.toFixed(3),
    stats.p95.toFixed(3),
    stats.p99.toFixed(3),
    stats.max.toFixed(3),
  ]);

  const colWidths = headers.map((h, i) => {
    const maxData = data.reduce((m, r) => Math.max(m, r[i].length), 0);
    return Math.max(h.length, maxData) + 2;
  });

  const divider = '+' + colWidths.map(w => '-'.repeat(w)).join('+') + '+';
  const fmtRow = (cells: string[]) =>
    '|' + cells.map((c, i) => ` ${c.padEnd(colWidths[i] - 1)}`).join('|') + '|';

  console.log('\n' + divider);
  console.log(fmtRow(headers));
  console.log(divider);
  for (const d of data) {
    console.log(fmtRow(d));
  }
  console.log(divider + '\n');
}

export function saveResults(name: string, data: Record<string, Stats>): void {
  const dir = path.join(__dirname, '../results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), ...data }, null, 2));
  console.log(`Results saved → results/${name}.json`);
}
