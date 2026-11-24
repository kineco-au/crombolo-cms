/**
 * `bun run test`: the unit suite in parallel, split into shards of about equal
 * time (`scripts/test-shard.ts`), one `bun test` process each. Every process is
 * isolated by `tests/support/isolate.ts`: its own directories and, on Postgres,
 * its own database. Each shard's output is printed as it finishes, then the
 * totals.
 *
 * Naming a file or a filter runs one plain `bun test` instead, as does
 * `CROMBOLO_TEST_SHARDS=1`. `--shard <n>/<total>` runs one CI job's share of the suite,
 * the files `scripts/test-shard.ts` gives that job, split again across this machine's
 * processes: CI shards across jobs, then each job across its processes.
 */

import { readFileSync, writeFileSync } from 'node:fs'
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
  // Postgres shards share one server locally, so fewer of them keep its timing
  // close to CI's, where each shard has a server of its own (story 231).
  const most = env.CROMBOLO_DB === 'postgres' ? 4 : 6
  return Math.max(1, Math.min(most, Math.floor(cpus / 2)))
}

export interface Totals {
  pass: number
  fail: number
  skip: number
}

/** `--shard <n>/<total>`, taken out of the arguments: which CI job's share this is. */
export function jobShard(args: readonly string[]): {
  job?: { shard: number; total: number }
  rest: string[]
} {
  const at = args.indexOf('--shard')
  if (at < 0) return { rest: [...args] }
  const match = /^(\d+)\/(\d+)$/.exec(args[at + 1] ?? '')
  if (!match) throw new Error('--shard takes <n>/<total>, such as 2/4.')
  const shard = Number(match[1])
  const total = Number(match[2])
  if (shard < 1 || shard > total) throw new Error(`--shard ${shard}/${total} is not one of them.`)
  return { job: { shard, total }, rest: [...args.slice(0, at), ...args.slice(at + 2)] }
}

/**
 * A file's results begin with its path on a line of its own, as `bun test` prints it: on
 * GitHub Actions in a log group, `##[group]tests/x.test.ts:`.
 */
export const FILE_HEADER = /^(?:##\[group\])?(tests\/[^\s:]+\.test\.tsx?):\s*$/

/**
 * A stream read to its end, noting when each test file's results began: a file's time is
 * from its header to the next one, or to the end. Times what `bun test` prints, so one
 * process's files are timed apart though it runs them together.
 */
export async function readTimed(
  stream: ReadableStream<Uint8Array>,
  now: () => number = () => performance.now(),
): Promise<{ text: string; seconds: Record<string, number> }> {
  const decoder = new TextDecoder()
  const seconds: Record<string, number> = {}
  let text = ''
  let pending = ''
  let current: { file: string; at: number } | undefined
  const close = (at: number) => {
    if (current) seconds[current.file] = (seconds[current.file] ?? 0) + (at - current.at) / 1000
  }
  const line = (l: string) => {
    const header = FILE_HEADER.exec(l)
    if (!header) return
    const at = now()
    close(at)
    current = { file: header[1] as string, at }
  }
  for await (const chunk of stream) {
    const part = decoder.decode(chunk, { stream: true })
    text += part
    pending += part
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const l of lines) line(l)
  }
  if (pending) line(pending)
  close(now())
  return { text, seconds }
}

/** The counts `bun test` prints at the end of a run. */
export function totalsOf(output: string): Totals {
  const count = (word: string) =>
    Number(new RegExp(`^\\s*(\\d+) ${word}$`, 'm').exec(output)?.[1] ?? 0)
  return { pass: count('pass'), fail: count('fail'), skip: count('skip') }
}

async function main(argv: string[]): Promise<number> {
  const { job, rest: args } = jobShard(argv)
  const total = shardCount(Bun.env, availableParallelism())
  const weights = JSON.parse(
    readFileSync(join(ROOT, 'tests', 'shard-weights.json'), 'utf8'),
  ) as Record<string, number>
  // A CI job's share of the suite, or all of it.
  const mine = job
    ? (shards(testFiles('unit'), job.total, weights)[job.shard - 1] ?? [])
    : testFiles('unit')
  if (!job && (total === 1 || namesTests(args))) {
    const run = Bun.spawn(['bun', 'test', ...args], { stdio: ['inherit', 'inherit', 'inherit'] })
    return run.exited
  }
  const sets = shards(mine, total, weights).filter((files) => files.length > 0)
  const started = performance.now()
  const timings: Record<string, number> = {}
  console.log(`bun run test: ${sets.length} shards in parallel`)
  const results = await Promise.all(
    sets.map(async (files, i) => {
      const run = Bun.spawn(['bun', 'test', ...args, ...files.map((f) => `./${f}`)], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      // `bun test` reports on stderr; each file timed as its results arrive.
      const [out, err, code] = await Promise.all([
        new Response(run.stdout).text(),
        readTimed(run.stderr),
        run.exited,
      ])
      Object.assign(timings, err.seconds)
      const output = out + err.text
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
  // For `bun run test:weights`: each file's seconds, where CI asks for them.
  if (Bun.env.CROMBOLO_TEST_TIMINGS)
    writeFileSync(Bun.env.CROMBOLO_TEST_TIMINGS, `${JSON.stringify(timings, null, 2)}\n`)
  const failed = results.filter((r) => r.code !== 0).map((r) => r.shard)
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  console.log(`\n── all shards, ${seconds}s ──`)
  console.log(` ${sum.pass} pass\n ${sum.skip} skip\n ${sum.fail} fail`)
  if (failed.length > 0) console.log(`shards that failed: ${failed.join(', ')}`)
  return failed.length > 0 ? 1 : 0
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
