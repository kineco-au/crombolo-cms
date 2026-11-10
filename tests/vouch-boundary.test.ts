/**
 * Story 319: vouching for a bundle is an argument only code in the process can
 * pass, never a value a request carries. The server's HTTP handlers call the
 * content check and install with three arguments, and nowhere name a vouch.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SERVER = join(import.meta.dir, '..', 'packages/server/src')

/** Where a request's bundle reaches the check or the install. */
const HANDLERS = ['remote.ts', 'transfer-dashboard.ts', 'bundle-admin.ts', 'server.ts']

/** The number of top-level arguments of each call to `name` in `source`. */
function argumentCounts(source: string, name: string): number[] {
  const counts: number[] = []
  for (const match of source.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
    let depth = 0
    let commas = 0
    let last = ''
    for (let i = (match.index as number) + match[0].length; i < source.length; i++) {
      const char = source[i] as string
      if (depth === 0 && char === ')') {
        // A trailing comma is not another argument.
        counts.push(last === '' ? 0 : commas + (last === ',' ? 0 : 1))
        break
      }
      if ('([{'.includes(char)) depth++
      else if (')]}'.includes(char)) depth--
      else if (char === ',' && depth === 0) commas++
      if (!/\s/.test(char)) last = char
    }
  }
  return counts
}

describe('vouching for a bundle', () => {
  test('no HTTP handler passes a vouch to the check or the install', () => {
    const found: string[] = []
    for (const file of HANDLERS) {
      const source = readFileSync(join(SERVER, file), 'utf8')
      if (/\bvouchedBy\b|\bVouch\b/.test(source)) found.push(`${file}: names a vouch`)
      for (const name of ['installBundleContent', 'checkBundleContent'])
        for (const count of argumentCounts(source, name))
          if (count > 3) found.push(`${file}: ${name} with ${count} arguments`)
    }
    expect(found).toEqual([])
  })

  test('the check counts what it is meant to', () => {
    expect(
      argumentCounts(
        'installBundleContent(db, config, { a: 1, b: [2, 3] })',
        'installBundleContent',
      ),
    ).toEqual([3])
    expect(
      argumentCounts(
        'installBundleContent(\n  db,\n  config,\n  input,\n  vouch,\n)',
        'installBundleContent',
      ),
    ).toEqual([4])
    expect(
      argumentCounts('checkBundleContent(db, config, f(x, y), v)', 'checkBundleContent'),
    ).toEqual([4])
  })
})
