/**
 * Story 085: every test that runs on one database only, found in the code, for
 * `tests/dialect-skips.test.ts` to hold to the reviewed list in `docs/testing.md`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface DialectSkip {
  file: string
  title: string
  /** The one database it runs on. */
  runsOn: 'sqlite' | 'postgres'
}

const TITLE = String.raw`\s*(?<q>['"\x60])(?<title>(?:(?!\k<q>).)+)\k<q>`

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'support' && name !== 'node_modules') files(path, out)
    } else if (/\.(test|integration|browser)\.ts$/.test(name)) out.push(path)
  }
  return out
}

/** Each skip by dialect in `root`'s tests, and each early return that hides one. */
export function findDialectSkips(root: string): { skips: DialectSkip[]; hidden: string[] } {
  const skips: DialectSkip[] = []
  const hidden: string[] = []
  for (const path of files(join(root, 'tests'))) {
    const file = relative(root, path).split('\\').join('/')
    const text = readFileSync(path, 'utf8')
    const direct = new RegExp(
      String.raw`(?:test|describe|it)\.skipIf\(dialectUnderTest !== '(sqlite|postgres)'[^)]*\)\(` +
        TITLE,
      'gs',
    )
    for (const m of text.matchAll(direct))
      skips.push({ file, title: m.groups?.title as string, runsOn: m[1] as DialectSkip['runsOn'] })
    const named =
      /const (\w+) = (?:test|describe)\.skipIf\(dialectUnderTest !== '(sqlite|postgres)'\)/g
    for (const m of text.matchAll(named))
      for (const use of text.matchAll(new RegExp(String.raw`\b${m[1]}\(` + TITLE, 'gs')))
        skips.push({
          file,
          title: use.groups?.title as string,
          runsOn: m[2] as DialectSkip['runsOn'],
        })
    // The integration suite's own switch (tests/integration/support/database.ts).
    for (const m of text.matchAll(
      new RegExp(String.raw`(?:test|describe)\.skipIf\(onPostgres\)\(` + TITLE, 'gs'),
    ))
      skips.push({ file, title: m.groups?.title as string, runsOn: 'sqlite' })
    text.split('\n').forEach((line, i) => {
      if (/if \(dialectUnderTest !== '(sqlite|postgres)'\) return\b/.test(line))
        hidden.push(`${file}:${i + 1}`)
    })
  }
  return { skips, hidden }
}
