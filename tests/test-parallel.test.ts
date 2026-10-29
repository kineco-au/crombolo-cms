/** `bun run test` shards the suite locally: when it does, how many, and how it adds up. */
import { describe, expect, test } from 'bun:test'
import { namesTests, shardCount, totalsOf } from '../scripts/test-parallel.ts'

describe('naming tests', () => {
  test('a file or a filter runs one plain bun test', () => {
    expect(namesTests(['tests/documents.test.ts'])).toBe(true)
    expect(namesTests(['--timeout', '20000', 'documents'])).toBe(true)
  })

  test("a flag's value is not a filter", () => {
    expect(namesTests([])).toBe(false)
    expect(namesTests(['--timeout', '20000'])).toBe(false)
    expect(namesTests(['-t', 'publishes', '--bail'])).toBe(false)
  })
})

describe('the number of shards', () => {
  test('is half the processors, at most six, and at least one', () => {
    expect(shardCount({}, 14)).toBe(6)
    expect(shardCount({}, 8)).toBe(4)
    expect(shardCount({}, 1)).toBe(1)
  })

  test('CROMBOLO_TEST_SHARDS sets it, and a nonsense value is ignored', () => {
    expect(shardCount({ CROMBOLO_TEST_SHARDS: '3' }, 14)).toBe(3)
    expect(shardCount({ CROMBOLO_TEST_SHARDS: '1' }, 14)).toBe(1)
    expect(shardCount({ CROMBOLO_TEST_SHARDS: 'lots' }, 14)).toBe(6)
  })
})

test('the totals are read from the end of a run', () => {
  const output = '(pass) a > b\n\n 12 pass\n 2 skip\n 1 fail\n 40 expect() calls\n'
  expect(totalsOf(output)).toEqual({ pass: 12, fail: 1, skip: 2 })
  expect(totalsOf('no summary')).toEqual({ pass: 0, fail: 0, skip: 0 })
})
