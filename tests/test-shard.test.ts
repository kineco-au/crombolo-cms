/** CI's split of the suite into parallel jobs (scripts/test-shard.ts). */
import { describe, expect, test } from 'bun:test'
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
