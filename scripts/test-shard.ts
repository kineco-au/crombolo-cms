/**
 * One shard of a suite, for CI to run in parallel jobs: files split into `total`
 * sets of about equal time, printed one per line as paths `bun test` takes.
 *
 *   bun run scripts/test-shard.ts <shard> <total> [unit|load]    1-based shard
 *
 * Times come from `shard-weights.json` in `tests/` or `tests/load/`, each file's
 * seconds on Postgres in CI. A file with no time counts as the median. The split
 * is deterministic, so the shards together are always the whole suite.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './packages.ts'

const TESTS = join(ROOT, 'tests')
type Suite = 'unit' | 'load'

const directory = (suite: Suite) => (suite === 'load' ? join(TESTS, 'load') : TESTS)

/** Unit tests by default; `load` includes both load tests and benchmarks. */
export function testFiles(suite: Suite = 'unit'): string[] {
  const pattern = suite === 'load' ? /\.(load|bench)\.ts$/ : /\.test\.tsx?$/
  return readdirSync(directory(suite))
    .filter((name) => pattern.test(name))
    .map((name) => `${suite === 'load' ? 'tests/load' : 'tests'}/${name}`)
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
  const suite = process.argv[4] ?? 'unit'
  if (
    !Number.isInteger(shard) ||
    !Number.isInteger(total) ||
    shard < 1 ||
    shard > total ||
    (suite !== 'unit' && suite !== 'load')
  ) {
    console.error(
      'usage: bun run scripts/test-shard.ts <shard> <total> [unit|load], with 1 <= shard <= total',
    )
    process.exit(2)
  }
  const weights = JSON.parse(
    readFileSync(join(directory(suite), 'shard-weights.json'), 'utf8'),
  ) as Record<string, number>
  for (const file of shards(testFiles(suite), total, weights)[shard - 1] ?? [])
    console.log(`./${file}`)
}
