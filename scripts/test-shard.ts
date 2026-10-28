/**
 * One shard of the unit suite, for CI to run in parallel jobs: the test files
 * `bun test` collects, split into `total` sets of about equal time, printed one
 * per line as paths `bun test` takes.
 *
 *   bun run scripts/test-shard.ts <shard> <total>    1-based shard
 *
 * Times come from `tests/shard-weights.json`, each file's seconds on Postgres in
 * CI, where sharding pays. A file with no time, such as a new one, counts as the
 * median. The split is deterministic, so every job agrees on which file is
 * whose, and the shards together are always the whole suite.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './packages.ts'

const TESTS = join(ROOT, 'tests')
const WEIGHTS = join(TESTS, 'shard-weights.json')

/** What `bun test` collects here: `*.test.ts(x)` directly under `tests/`. */
export function testFiles(): string[] {
  return readdirSync(TESTS)
    .filter((name) => /\.test\.tsx?$/.test(name))
    .map((name) => `tests/${name}`)
    .sort()
}

/** Every file in exactly one of `total` shards, heaviest first onto the lightest. */
export function shards(
  files: readonly string[],
  total: number,
  weights: Record<string, number>,
): string[][] {
  const known = Object.values(weights).sort((a, b) => a - b)
  const median = known.length > 0 ? (known[Math.floor(known.length / 2)] as number) : 1
  const weigh = (file: string) => weights[file] ?? median
  const bins = Array.from({ length: total }, () => ({ files: [] as string[], time: 0 }))
  const ordered = [...files].sort((a, b) => weigh(b) - weigh(a) || a.localeCompare(b))
  for (const file of ordered) {
    const lightest = bins.reduce((min, bin) => (bin.time < min.time ? bin : min))
    lightest.files.push(file)
    lightest.time += weigh(file)
  }
  return bins.map((bin) => bin.files.sort())
}

if (import.meta.main) {
  const shard = Number(process.argv[2])
  const total = Number(process.argv[3])
  if (!Number.isInteger(shard) || !Number.isInteger(total) || shard < 1 || shard > total) {
    console.error('usage: bun run scripts/test-shard.ts <shard> <total>, with 1 <= shard <= total')
    process.exit(2)
  }
  const weights = JSON.parse(readFileSync(WEIGHTS, 'utf8')) as Record<string, number>
  for (const file of shards(testFiles(), total, weights)[shard - 1] ?? []) console.log(`./${file}`)
}
