/**
 * `bun run test`: the unit suite in parallel, split into shards of about equal
 * time (`scripts/test-shard.ts`), one `bun test` process each. Every process is
 * isolated by `tests/support/isolate.ts`: its own directories and, on Postgres,
 * its own database. Each shard's output is printed as it finishes, then the
 * totals.
 *
 * Naming a file or a filter runs one plain `bun test` instead, as does
 * `CROMBOLO_TEST_SHARDS=1`. CI shards across jobs with `test:ci`, not this.
 */

import { readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { ROOT } from './packages.ts'
import { shards, testFiles } from './test-shard.ts'

/** Flags whose value is the next argument, so it is not mistaken for a file or filter. */
const TAKES_VALUE = new Set([
  '--timeout',
  '-t',
  '--test-name-pattern',
  '--rerun-each',
  '--preload',
  '--reporter',
  '--reporter-outfile',
  '--coverage-dir',
  '--seed',
])

export function namesTests(args: readonly string[]): boolean {
  return args.some((arg, i) => !arg.startsWith('-') && !TAKES_VALUE.has(args[i - 1] ?? ''))
}

export function shardCount(env: Record<string, string | undefined>, cpus: number): number {
  const asked = Number(env.CROMBOLO_TEST_SHARDS)
  if (Number.isInteger(asked) && asked >= 1) return asked
  return Math.max(1, Math.min(6, Math.floor(cpus / 2)))
}

export interface Totals {
  pass: number
  fail: number
  skip: number
}

/** The counts `bun test` prints at the end of a run. */
export function totalsOf(output: string): Totals {
  const count = (word: string) =>
    Number(new RegExp(`^\\s*(\\d+) ${word}$`, 'm').exec(output)?.[1] ?? 0)
  return { pass: count('pass'), fail: count('fail'), skip: count('skip') }
}

async function main(args: string[]): Promise<number> {
  const total = shardCount(Bun.env, availableParallelism())
  if (total === 1 || namesTests(args)) {
    const run = Bun.spawn(['bun', 'test', ...args], { stdio: ['inherit', 'inherit', 'inherit'] })
    return run.exited
  }
  const weights = JSON.parse(
    readFileSync(join(ROOT, 'tests', 'shard-weights.json'), 'utf8'),
  ) as Record<string, number>
  const sets = shards(testFiles('unit'), total, weights).filter((files) => files.length > 0)
  const started = performance.now()
  console.log(`bun run test: ${sets.length} shards in parallel`)
  const results = await Promise.all(
    sets.map(async (files, i) => {
      const run = Bun.spawn(['bun', 'test', ...args, ...files.map((f) => `./${f}`)], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [out, err, code] = await Promise.all([
        new Response(run.stdout).text(),
        new Response(run.stderr).text(),
        run.exited,
      ])
      const output = out + err
      const seconds = ((performance.now() - started) / 1000).toFixed(0)
      console.log(
        `\n── shard ${i + 1}/${sets.length}: ${files.length} files, done at ${seconds}s ──`,
      )
      console.log(output.trimEnd())
      return { code, totals: totalsOf(output), shard: i + 1 }
    }),
  )
  const sum = results.reduce(
    (acc, r) => ({
      pass: acc.pass + r.totals.pass,
      fail: acc.fail + r.totals.fail,
      skip: acc.skip + r.totals.skip,
    }),
    { pass: 0, fail: 0, skip: 0 },
  )
  const failed = results.filter((r) => r.code !== 0).map((r) => r.shard)
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  console.log(`\n── all shards, ${seconds}s ──`)
  console.log(` ${sum.pass} pass\n ${sum.skip} skip\n ${sum.fail} fail`)
  if (failed.length > 0) console.log(`shards that failed: ${failed.join(', ')}`)
  return failed.length > 0 ? 1 : 0
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
