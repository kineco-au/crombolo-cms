/** The rule against hand-written SQL (story 221). */
import { describe, expect, test } from 'bun:test'
import { filesWithSql, literals } from '../scripts/check-sql.ts'

describe('literals', () => {
  test('finds strings and templates, with interpolations as ?, and skips comments', () => {
    const source = [
      "// 'SELECT in a comment'",
      '/* "nor here" */',
      "const a = 'one'",
      'const b = "two"',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test
      'const c = `three ${x + `inner`} four`',
    ].join('\n')
    expect(literals(source)).toEqual(['one', 'two', 'inner', 'three ? four'])
  })

  test('a regular expression holding a quote does not swallow what follows', () => {
    const source = "const r = /'[^']*'/g\nconst s = 'after'"
    expect(literals(source)).toEqual(['after'])
  })

  test('division is not mistaken for a regular expression', () => {
    expect(literals("const half = total / 2 / 'x'.length")).toEqual(['x'])
  })
})

describe('the rule', () => {
  test('no file holds hand-written SQL outside the places it is allowed', () => {
    expect(filesWithSql()).toEqual([])
  })
})
