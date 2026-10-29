/** CI's split of the suite into parallel jobs (scripts/test-shard.ts). */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../scripts/packages.ts'
import { shards, testFiles } from '../scripts/test-shard.ts'

describe('the test shards', () => {
  test('put every file in exactly one shard', () => {
    const files = testFiles()
    const split = shards(files, 4, {})
    expect(split.flat().sort()).toEqual(files)
    expect(new Set(split.flat()).size).toBe(files.length)
  })

  test('balance by measured time, heaviest first onto the lightest', () => {
    const split = shards(['a', 'b', 'c', 'd'], 2, { a: 10, b: 6, c: 4, d: 1 })
    expect(split).toEqual([
      ['a', 'd'],
      ['b', 'c'],
    ])
  })

  test('weigh a file with no time as the median, so a new file still lands somewhere', () => {
    // The median of 1, 2 and 30 is 2: the new file is light, so it joins the
    // light shard rather than the one holding the 30-second file.
    const split = shards(['a', 'b', 'c', 'new'], 2, { a: 1, b: 2, c: 30 })
    expect(split.flat().sort()).toEqual(['a', 'b', 'c', 'new'])
    expect(split.find((s) => s.includes('c'))).toEqual(['c'])
  })

  test('agree between jobs: the same input gives the same split', () => {
    const files = testFiles()
    expect(shards(files, 4, {})).toEqual(shards([...files].reverse(), 4, {}))
  })

  test('one shard is the whole suite', () => {
    expect(shards(testFiles(), 1, {})[0]).toEqual(testFiles())
  })
})

const select = async (...args: string[]) => {
  const child = Bun.spawn([process.execPath, join(ROOT, 'scripts/test-shard.ts'), ...args], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

describe('selecting a suite from the command line', () => {
  test('keeps the existing unit invocation as the default', async () => {
    const [implicit, explicit] = await Promise.all([select('1', '4'), select('1', '4', 'unit')])
    expect(implicit.code).toBe(0)
    expect(implicit).toEqual(explicit)
    expect(implicit.stdout).toContain('.test.ts')
    expect(implicit.stdout).not.toContain('tests/load/')
  })

  test('covers every load test and benchmark exactly once, with no empty job', async () => {
    const files = testFiles('load')
    expect(files).toContain('tests/load/concurrency.load.ts')
    expect(files).toContain('tests/load/large-site.bench.ts')
    expect(files).toContain('tests/load/media-library.bench.ts')
    const results = await Promise.all([1, 2, 3].map((shard) => select(String(shard), '3', 'load')))
    const selected = results.flatMap(({ code, stdout, stderr }) => {
      expect(code, stderr).toBe(0)
      expect(stdout.trim()).not.toBe('')
      return stdout
        .trim()
        .split('\n')
        .map((file) => file.replace(/^\.\//, ''))
    })
    expect(selected.sort()).toEqual(files)
    expect(new Set(selected).size).toBe(files.length)
  })

  test('refuses an unknown suite or invalid index before printing any files', async () => {
    for (const args of [
      ['1', '3', 'bench'],
      ['0', '3', 'load'],
      ['4', '3', 'load'],
      ['1', '0', 'load'],
    ]) {
      const result = await select(...args)
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('usage:')
    }
  })
})

interface LoadJob {
  strategy: {
    'fail-fast': boolean
    matrix: { include: Array<{ dialect: string; shard: number; shards: number }> }
  }
  steps: Array<{ if?: string; run?: string }>
  env: Record<string, string>
}

describe('the release load matrix', () => {
  const workflow = Bun.YAML.parse(
    readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8'),
  ) as { jobs: { load: LoadJob; publish: { needs: string[] } } }
  const job = workflow.jobs.load

  test('runs all three Postgres shards and keeps SQLite whole', () => {
    const postgres = job.strategy.matrix.include.filter((entry) => entry.dialect === 'postgres')
    expect(postgres.map((entry) => entry.shard).sort()).toEqual([1, 2, 3])
    expect(postgres.every((entry) => entry.shards === 3)).toBe(true)
    expect(job.strategy.matrix.include.filter((entry) => entry.dialect === 'sqlite')).toEqual([
      { dialect: 'sqlite', shard: 1, shards: 1 },
    ])
    expect(job.strategy['fail-fast']).toBe(false)
  })

  test('selects the load suite for shards and retains both SQLite wrappers', () => {
    const shard = job.steps.find((step) => step.run?.includes('scripts/test-shard.ts'))
    expect(shard?.if).toBe('matrix.shards > 1')
    expect(shard?.run).toMatch(/\$\{\{ matrix\.shard \}\} \$\{\{ matrix\.shards \}\} load/)
    expect(shard?.run).toContain('test -n "$files"')
    expect(shard?.run).toContain('bun run test:ci --timeout 600000 $files')
    for (const wrapper of ['test:load', 'test:bench'])
      expect(job.steps.find((step) => step.run === `bun run ${wrapper}`)?.if).toBe(
        'matrix.shards == 1',
      )
    expect(job.env.CROMBOLO_LOAD_OPS).toBe('1500')
  })

  test('requires the entire load matrix before publishing', () => {
    expect(workflow.jobs.publish.needs).toContain('load')
    expect(workflow.jobs.publish.needs).toContain('ci')
  })
})
