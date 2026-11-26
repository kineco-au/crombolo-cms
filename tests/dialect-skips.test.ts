/**
 * Story 085: a test that runs on one database only is on the reviewed list in
 * `docs/testing.md`, "One database only", with why; one that is not, or a row whose test
 * is gone, fails here. An early return that hides a skip is refused outright.
 */
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findDialectSkips } from './support/dialect-skips.ts'

const ROOT = join(import.meta.dir, '..')

function reviewed(): string[] {
  const doc = readFileSync(join(ROOT, 'docs', 'testing.md'), 'utf8')
  const start = doc.indexOf('## One database only')
  const section = doc.slice(start, doc.indexOf('\n## ', start + 1))
  const rows: string[] = []
  for (const line of section.split('\n')) {
    const row = /^\| `([^`]+)` \| (.+?) \| (sqlite|postgres) \| (.+) \|$/.exec(line)
    if (!row) continue
    expect(row[4]?.trim().length, `${row[1]}: ${row[2]} says why`).toBeGreaterThan(10)
    rows.push(`${row[1]} | ${row[2]} | ${row[3]}`)
  }
  return rows.sort()
}

test('every test that runs on one database only is reviewed, with why', () => {
  const { skips, hidden } = findDialectSkips(ROOT)
  expect(hidden, 'name the skip with test.skipIf, and list it in docs/testing.md').toEqual([])
  const found = skips.map((s) => `${s.file} | ${s.title} | ${s.runsOn}`).sort()
  expect(
    found,
    'docs/testing.md, "One database only": a row for each, and none for a test gone',
  ).toEqual(reviewed())
})
