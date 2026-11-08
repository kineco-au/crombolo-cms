/**
 * JSX in a view's code editor is coloured: monaco's TypeScript grammar gains
 * states for tags, attributes and `{…}`, and keeps every rule it had. The
 * browser suite checks the tokens monaco makes (`settings.browser.ts`).
 */
import { describe, expect, test } from 'bun:test'
import {
  TAG_START,
  TYPE_ARGUMENTS,
  withJsx,
} from '../packages/backoffice-host/plugin/tsx-highlighting.js'

const TS = {
  defaultToken: 'invalid',
  tokenizer: {
    root: [[/[{}]/, 'delimiter.bracket'], { include: 'common' }] as unknown[],
    common: [[/[a-z_$][\w$]*/, 'identifier']] as unknown[],
  },
}

describe('the grammar with JSX', () => {
  test('keeps TypeScript’s own rules and settings, after its own', () => {
    const jsx = withJsx(TS) as unknown as typeof TS & { tokenizer: Record<string, unknown[]> }
    expect(jsx.defaultToken).toBe('invalid')
    expect(jsx.tokenizer.common).toBe(TS.tokenizer.common)
    expect(jsx.tokenizer.root?.slice(-2)).toEqual(TS.tokenizer.root)
    expect(Object.keys(jsx.tokenizer)).toEqual(
      expect.arrayContaining(['jsxTag', 'jsxChildren', 'jsxExpression']),
    )
  })

  test('reads a name and its < as a type argument before a tag can start there', () => {
    const root = withJsx(TS).tokenizer.root as Array<[RegExp, unknown]>
    expect(root[0]?.[0]).toBe(TYPE_ARGUMENTS)
    expect(root[1]?.[0]).toBe(TAG_START)
    expect(TYPE_ARGUMENTS.exec('useState<string>(')?.[0]).toBe('useState<')
    expect(TAG_START.exec('<div className="x">')?.[2]).toBe('div')
    expect(TAG_START.exec('< b')).toBeNull()
  })
})
