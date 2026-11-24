/**
 * `bun run ci:weights <run-id>`: `tests/shard-weights.json` from a CI run's Postgres
 * jobs, so `scripts/test-shard.ts` splits the suite by what each file takes now.
 *
 * Each job uploads the seconds `scripts/test-parallel.ts` timed per file
 * (`test-timings-postgres-<n>`). A run without them, whose jobs ran one file at a time,
 * is read from its logs instead: a file's time is from its `##[group]` line to the next.
 * A file this run did not time keeps its weight; a file no longer there is dropped.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT } from './packages.ts'
import { testFiles } from './test-shard.ts'

const WEIGHTS = join(ROOT, 'tests', 'shard-weights.json')
const HEADER = /^(\S+Z) (?:##\[group\])?(tests\/[^\s:]+\.test\.tsx?):\s*$/

/** Seconds per file from a job's log, one file at a time: header to header. Pure. */
export function secondsFromLog(log: string): Record<string, number> {
  const out: Record<string, number> = {}
  let current: { file: string; at: number } | undefined
  for (const line of log.split('\n')) {
    const stamp = /^(\S+Z) /.exec(line)?.[1]
    const header = HEADER.exec(line)
    const at = stamp ? Date.parse(stamp) : Number.NaN
    if (Number.isNaN(at)) continue
    const ended = header || /^\S+Z\s+\d+ pass\s*$/.test(line)
    if (ended && current) {
      out[current.file] = (out[current.file] ?? 0) + (at - current.at) / 1000
      current = undefined
    }
    if (header) current = { file: header[2] as string, at }
  }
  return out
}

/** The weights a run's seconds make, keeping what it did not time, for the files there are. Pure. */
export function mergeWeights(
  before: Record<string, number>,
  seconds: Record<string, number>,
  files: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const file of [...files].sort()) {
    const time = seconds[file] ?? before[file]
    if (time !== undefined) out[file] = Math.max(0.1, Math.round(time * 10) / 10)
  }
  return out
}

const gh = (args: string[]) => {
  const run = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' })
  if (run.exitCode !== 0) throw new Error(`gh ${args.join(' ')}: ${run.stderr.toString()}`)
  return run.stdout.toString()
}

async function main(runId: string | undefined): Promise<number> {
  if (!runId) {
    console.error('Usage: bun run ci:weights <run-id>, a CI run with --postgres-tests.')
    return 2
  }
  const seconds: Record<string, number> = {}
  const dir = mkdtempSync(join(tmpdir(), 'test-weights-'))
  try {
    const listed = Bun.spawnSync(
      ['gh', 'run', 'download', runId, '--pattern', 'test-timings-postgres-*', '--dir', dir],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    if (listed.exitCode === 0)
      for (const sub of readdirSync(dir))
        for (const name of readdirSync(join(dir, sub)))
          Object.assign(seconds, JSON.parse(readFileSync(join(dir, sub, name), 'utf8')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  if (Object.keys(seconds).length === 0) {
    const jobs = JSON.parse(gh(['run', 'view', runId, '--json', 'jobs'])) as {
      jobs: Array<{ name: string; databaseId: number }>
    }
    for (const job of jobs.jobs.filter((j) => j.name.startsWith('test (postgres'))) {
      const log = gh([
        'api',
        '--allow-escape-sequences',
        `repos/{owner}/{repo}/actions/jobs/${job.databaseId}/logs`,
      ])
      // biome-ignore lint/suspicious/noControlCharactersInRegex: a log's colour codes are what it strips
      Object.assign(seconds, secondsFromLog(log.replace(/\x1b\[[0-9;]*m/g, '')))
    }
  }
  if (Object.keys(seconds).length === 0) {
    console.error(`Run ${runId} timed no test file: was it run with --postgres-tests?`)
    return 1
  }
  const before = JSON.parse(readFileSync(WEIGHTS, 'utf8')) as Record<string, number>
  const files = testFiles('unit')
  const after = mergeWeights(before, seconds, files)
  writeFileSync(WEIGHTS, `${JSON.stringify(after, null, 2)}\n`)
  const timed = files.filter((f) => seconds[f] !== undefined).length
  console.log(`tests/shard-weights.json: ${timed} of ${files.length} files timed by run ${runId}`)
  return 0
}

if (import.meta.main) process.exit(await main(process.argv[2]))
